// Hoops Rotation — the planning engine. No DOM, no Firebase: the page calls
// RotationEngine.plan(...) and Node can load it for testing.
//
// The game is a grid of equal ticks (1 minute or 30 seconds). The planner
// picks a lineup for every tick, which means it also picks when subs happen.
// Every tick has exactly one player at each position 1–5. The first tick is
// the starting five; the closing five play the last stretch.
//
// Stages:
//   1. Targets: each player's percent is scaled so the team totals 500%
//      (5 players on the floor), nobody above 100%.
//   2. Search: simulated annealing over the whole grid (see `search`), with
//      the sub rules (max players in per sub, minimum stint) as penalties
//      that tighten as it runs, and minutes, even spacing and few stoppages
//      as goals. Several runs; the best one wins.
//   3. Positions: a dynamic program picks positions per segment so players
//      change spots as little as possible.

(function (root) {
    "use strict";

    const NPOS = 5;

    // Small seeded random generator (mulberry32), so a seed reproduces a plan.
    function makeRng(seed) {
        let a = seed >>> 0;
        return function () {
            a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    // ---- Stage 1: targets ----

    // scaleShares(pcts) → array of shares (fraction of the game, 0..1) that
    // add up to 5. Percents are scaled by one common factor; anyone who would
    // go over 100% is capped and the rest are scaled up to make up for it.
    function scaleShares(pcts) {
        const p = pcts.map(function (x) { return Math.max(0, Number(x) || 0); });
        const n = p.length;
        const total = p.reduce(function (a, b) { return a + b; }, 0);
        if (total === 0) return p.map(function () { return NPOS / n; });

        function filled(k) {
            return p.reduce(function (sum, x) { return sum + Math.min(1, k * x); }, 0);
        }
        const positives = p.filter(function (x) { return x > 0; }).length;
        let shares;
        if (positives >= NPOS) {
            // Binary search the factor k with Σ min(1, k·p) = 5.
            let lo = 0, hi = 1;
            while (filled(hi) < NPOS) hi *= 2;
            for (let i = 0; i < 100; i++) {
                const mid = (lo + hi) / 2;
                if (filled(mid) < NPOS) lo = mid; else hi = mid;
            }
            shares = p.map(function (x) { return Math.min(1, hi * x); });
        } else {
            // Fewer than 5 players asked for any time: they all get 100%,
            // and the players at 0% split what's left evenly.
            const zeros = n - positives;
            const rest = (NPOS - positives) / zeros;
            shares = p.map(function (x) { return x > 0 ? 1 : rest; });
        }
        return shares;
    }

    // ---- Matching helpers ----

    // canFill(players, posMasks) — can these 5 players take positions 1–5,
    // one each, only at positions they play? posMasks[i] has bit j set when
    // player i plays position j+1.
    function canFill(playerIdx, posMasks) {
        function go(pos, used) {
            if (pos === NPOS) return true;
            for (let k = 0; k < playerIdx.length; k++) {
                if (used & (1 << k)) continue;
                if (posMasks[playerIdx[k]] & (1 << pos)) {
                    if (go(pos + 1, used | (1 << k))) return true;
                }
            }
            return false;
        }
        return playerIdx.length === NPOS && go(0, 0);
    }

    // All ways to place 5 players at positions 1–5. Each result is an array
    // of player indices in position order.
    function allFills(playerIdx, posMasks) {
        const out = [];
        const cur = [];
        function go(pos, used) {
            if (pos === NPOS) { out.push(cur.slice()); return; }
            for (let k = 0; k < playerIdx.length; k++) {
                if (used & (1 << k)) continue;
                const pi = playerIdx[k];
                if (posMasks[pi] & (1 << pos)) {
                    cur.push(pi);
                    go(pos + 1, used | (1 << k));
                    cur.pop();
                }
            }
        }
        go(0, 0);
        return out;
    }
    // ---- The schedule search ----
    //
    // The game is a grid of T ticks (e.g. 1 minute each). mask[t] is the set
    // of players on the floor during tick t (bit i = player i). A sub happens
    // at boundary t (between tick t−1 and t) when mask[t] ≠ mask[t−1].
    //
    // Fixed: tick 0 is the starters; the last `closeTicks` ticks are the
    // closers. Everything in between is searched by simulated annealing.
    //
    // Rules (penalised heavily, and the penalty grows during the search so
    // the final plan obeys them whenever it can):
    //   - at most `maxSubs` players come in at one sub, except at period breaks
    //   - every stint on the floor lasts at least `minStint` ticks
    // Goals (traded off against each other):
    //   - each player's minutes close to target (squared minutes off)
    //   - each player's time spread evenly through the game
    //   - few sub stoppages (two players in at once beats two separate subs)
    // Hard: every tick has a lineup that can cover 1–5 (moves that break it
    // are never made).

    const WEIGHTS = {
        spread: 1,    // per player, average squared minutes off an even pace
        event: 2,     // per sub stoppage (not counting period breaks)
        bench: 1,     // squared minutes of each stretch on the bench, per game minute
        gap: 1.5      // per minute two stoppages are closer than the minimum stint
    };

    function popcount(x) {
        x = x - ((x >>> 1) & 0x55555555);
        x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
        return (((x + (x >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24;
    }

    function search(ctx, rng) {
        const n = ctx.n, T = ctx.T, L = ctx.L, tickMin = ctx.tickMin;
        const mask = new Array(T);
        for (let t = 0; t < T; t++) mask[t] = t < L ? ctx.starterMask : ctx.closerMask;

        function on(i, t) { return (mask[t] >>> i) & 1; }

        // Per player: soft cost (minutes + spread) and rule breaks (short stints).
        function playerCost(i) {
            let count = 0;
            for (let t = 0; t < T; t++) count += on(i, t);
            const off = (count - ctx.targets[i]) * tickMin;
            let soft = off * off;
            let cum = 0, spread = 0;
            for (let t = 0; t < T; t++) {
                cum += on(i, t);
                const d = (cum - count * (t + 1) / T) * tickMin;
                spread += d * d;
            }
            soft += ctx.w.spread * spread / T;
            // Long sits: one 12-minute sit costs far more than two 6-minute ones.
            let benchRun = 0, bench = 0;
            for (let t = 0; t <= T; t++) {
                if (t < T && !on(i, t)) { benchRun++; continue; }
                bench += benchRun * benchRun;
                benchRun = 0;
            }
            soft += ctx.w.bench * bench * tickMin * tickMin / (T * tickMin);
            let viol = 0, run = 0;
            for (let t = 0; t <= T; t++) {
                if (t < T && on(i, t)) { run++; continue; }
                if (run > 0 && run < ctx.minStint) viol += ctx.minStint - run;
                run = 0;
            }
            return { soft: soft, viol: viol };
        }

        // The whole game's subs: a cost per stoppage, a cost when two
        // stoppages come close together (period starts count as stoppages
        // here, since a sub just after a break could have been made at it),
        // and rule breaks for too many players in at once.
        function subsCost() {
            let soft = 0, viol = 0, last = 0;
            for (let t = 1; t < T; t++) {
                const isBreak = t % ctx.periodTicks === 0;
                const ins = isBreak ? 0 : popcount(mask[t] & ~mask[t - 1]);
                if (ins === 0 && !isBreak) continue;
                const gap = t - last;
                if (gap < ctx.minStint) soft += ctx.w.gap * (ctx.minStint - gap) * tickMin;
                last = t;
                if (isBreak) continue;
                soft += ctx.w.event;
                viol += Math.max(0, ins - ctx.maxSubs);
            }
            return { soft: soft, viol: viol };
        }

        const pc = [];
        let soft = 0, viol = 0;
        for (let i = 0; i < n; i++) { pc.push(playerCost(i)); soft += pc[i].soft; viol += pc[i].viol; }
        let sc = subsCost();
        soft += sc.soft; viol += sc.viol;

        if (L <= 1) return { mask: mask, soft: soft, viol: viol };

        const ITER = ctx.iterations;
        let temp = 4.0;
        const tempEnd = 0.01;
        const cool = Math.pow(tempEnd / temp, 1 / ITER);
        let wHard = 2;
        const hardEnd = 200;
        const hardGrow = Math.pow(hardEnd / wHard, 1 / ITER);

        for (let it = 0; it < ITER; it++, temp *= cool, wHard *= hardGrow) {
            // Pick a tick, someone on the floor (x) and someone on the bench (y).
            const t = 1 + Math.floor(rng() * (L - 1));
            const m = mask[t];
            let x = -1;
            for (let tries = 0; tries < 10 && x === -1; tries++) {
                const c = Math.floor(rng() * n);
                if ((m >>> c) & 1) x = c;
            }
            if (x === -1) continue;
            const y = Math.floor(rng() * n);
            if ((m >>> y) & 1) continue;

            // The longest stretch around t where x is on and y is off; swap y
            // in for x over all of it or part of it (sharing one end).
            let lo = t, hi = t + 1;
            while (lo - 1 >= 1 && on(x, lo - 1) && !on(y, lo - 1)) lo--;
            while (hi < L && on(x, hi) && !on(y, hi)) hi++;
            let a = lo, b = hi;
            const r = rng();
            if (r < 0.35) { /* whole stretch */ }
            else if (r < 0.675) b = t + 1 + Math.floor(rng() * (hi - t));
            else a = lo + Math.floor(rng() * (t - lo + 1));

            const flip = (1 << x) | (1 << y);
            let okFill = true;
            for (let u = a; u < b && okFill; u++) okFill = ctx.fillOk(mask[u] ^ flip);
            if (!okFill) continue;

            for (let u = a; u < b; u++) mask[u] ^= flip;
            const nx = playerCost(x), ny = playerCost(y), ns = subsCost();
            const dSoft = nx.soft + ny.soft + ns.soft - pc[x].soft - pc[y].soft - sc.soft;
            const dViol = nx.viol + ny.viol + ns.viol - pc[x].viol - pc[y].viol - sc.viol;
            const delta = dSoft + wHard * dViol;
            if (delta <= 0 || rng() < Math.exp(-delta / temp)) {
                pc[x] = nx; pc[y] = ny; sc = ns;
                soft += dSoft; viol += dViol;
            } else {
                for (let u = a; u < b; u++) mask[u] ^= flip;
            }
        }
        return { mask: mask, soft: soft, viol: viol };
    }

    // ---- Main entry point ----

    // plan(opts)
    //   players:     [{ id, name, pct, positions: [1..5], starter, closer }] (those at the game)
    //   ticks:       number of grid ticks in the game (T)
    //   tickMinutes: length of one tick in minutes
    //   periodTicks: ticks per period (breaks allow any number of changes)
    //   maxSubs:     most players who can come in at one sub (outside breaks)
    //   minStint:    shortest time on the floor, in ticks
    //   closeTicks:  the closers play the last this-many ticks
    //   seed:        any integer; a different seed gives a different plan
    // Returns { ok: true, segments, counts, targets, warnings, issues }
    //   segments = [{ start, end, slots: [id at 1, ..., id at 5] }] in ticks
    //   counts[id], targets[id] in ticks; issues = check(...) of the result
    // or { ok: false, errors: [strings] }.
    function plan(opts) {
        const players = opts.players || [];
        const T = opts.ticks;
        const errors = [];

        if (players.length < NPOS) {
            errors.push("Only " + players.length + " player" + (players.length === 1 ? "" : "s") +
                " at the game. You need at least 5.");
        }
        if (players.length > 30) errors.push("At most 30 players.");
        const noPos = players.filter(function (p) { return !p.positions || p.positions.length === 0; });
        if (noPos.length) {
            errors.push(listNames(noPos) + (noPos.length === 1 ? " has" : " have") + " no positions selected.");
        }
        const starters = players.filter(function (p) { return p.starter; });
        const closers = players.filter(function (p) { return p.closer; });
        if (starters.length !== NPOS) errors.push("Pick exactly 5 starters (" + starters.length + " picked).");
        if (closers.length !== NPOS) errors.push("Pick exactly 5 closers (" + closers.length + " picked).");
        if (!(opts.closeTicks >= 1 && opts.closeTicks < T)) {
            errors.push("The closing stretch has to be shorter than the game.");
        }
        if (errors.length) return { ok: false, errors: errors };

        const n = players.length;
        const posMasks = players.map(function (p) {
            let m = 0;
            p.positions.forEach(function (x) { if (x >= 1 && x <= NPOS) m |= 1 << (x - 1); });
            return m;
        });
        const idx = players.map(function (_, i) { return i; });
        const starterIdx = idx.filter(function (i) { return players[i].starter; });
        const closerIdx = idx.filter(function (i) { return players[i].closer; });
        if (!canFill(starterIdx, posMasks)) {
            errors.push("The starters can't cover 1–5 with one player at each position. " +
                coverageHint(starterIdx, players, posMasks));
        }
        if (!canFill(closerIdx, posMasks)) {
            errors.push("The closers can't cover 1–5 with one player at each position. " +
                coverageHint(closerIdx, players, posMasks));
        }
        if (errors.length) return { ok: false, errors: errors };

        const shares = scaleShares(players.map(function (p) { return p.pct; }));
        const fillCache = new Map();
        const ctx = {
            n: n, T: T, L: T - opts.closeTicks,
            tickMin: opts.tickMinutes,
            periodTicks: opts.periodTicks,
            maxSubs: opts.maxSubs,
            minStint: opts.minStint,
            targets: shares.map(function (s) { return s * T; }),
            starterMask: starterIdx.reduce(function (m, i) { return m | (1 << i); }, 0),
            closerMask: closerIdx.reduce(function (m, i) { return m | (1 << i); }, 0),
            w: Object.assign({}, WEIGHTS, opts.weights || {}),
            iterations: opts.iterations || Math.min(300000, 5000 * T),
            fillOk: function (m) {
                let v = fillCache.get(m);
                if (v === undefined) {
                    const list = [];
                    for (let i = 0; i < n; i++) if ((m >>> i) & 1) list.push(i);
                    v = canFill(list, posMasks);
                    fillCache.set(m, v);
                }
                return v;
            }
        };

        // A few independent runs; keep the one with the fewest rule breaks,
        // then the lowest cost.
        const rng = makeRng(opts.seed == null ? 1 : opts.seed);
        const runs = opts.restarts || 3;
        let best = null;
        for (let r = 0; r < runs; r++) {
            const res = search(ctx, makeRng(Math.floor(rng() * 4294967296)));
            if (!best || res.viol < best.viol || (res.viol === best.viol && res.soft < best.soft)) best = res;
        }

        // Collapse equal neighbouring ticks into segments.
        const segs = [];
        for (let t = 0; t < T; t++) {
            if (segs.length && segs[segs.length - 1].mask === best.mask[t]) segs[segs.length - 1].end = t + 1;
            else segs.push({ start: t, end: t + 1, mask: best.mask[t] });
        }
        const onLists = segs.map(function (s) {
            const list = [];
            for (let i = 0; i < n; i++) if ((s.mask >>> i) & 1) list.push(i);
            return list;
        });
        const lineups = assignPositions(onLists, posMasks, segs.length, rng);

        const result = { ok: true, segments: [], counts: {}, targets: {}, warnings: [] };
        segs.forEach(function (s, k) {
            result.segments.push({ start: s.start, end: s.end,
                slots: lineups[k].map(function (i) { return players[i].id; }) });
        });
        players.forEach(function (p, i) {
            let c = 0;
            for (let t = 0; t < T; t++) c += (best.mask[t] >>> i) & 1;
            result.counts[p.id] = c;
            result.targets[p.id] = ctx.targets[i];
        });
        for (let pos = 0; pos < NPOS; pos++) {
            const who = idx.filter(function (i) { return posMasks[i] & (1 << pos); });
            if (who.length === 1) {
                const name = players[who[0]].name || "One player";
                result.warnings.push("Only " + name + " plays " + (pos + 1) + ", so " + name +
                    " plays the whole game.");
            }
        }
        result.issues = check(players, opts, result.segments);
        return result;
    }

    // check(players, rules, segments) — lists every rule a plan breaks, for
    // plans changed by hand. rules: { ticks, periodTicks, maxSubs, minStint, closeTicks }.
    // Each issue: { type, tick, ids, ... }
    //   too-many-subs { tick, count }      short-stint { tick (start), ids: [id], length }
    //   starters / closers { ids: the players who shouldn't be there }
    //   position { tick, ids: [id], position }
    function check(players, rules, segments) {
        const byId = {};
        players.forEach(function (p) { byId[p.id] = p; });
        const issues = [];
        const T = rules.ticks;
        const L = T - rules.closeTicks;

        segments.forEach(function (seg) {
            seg.slots.forEach(function (id, pos) {
                const p = byId[id];
                if (!p || p.positions.indexOf(pos + 1) === -1) {
                    issues.push({ type: "position", tick: seg.start, ids: [id], position: pos + 1 });
                }
            });
        });

        const first = segments[0];
        const wrongStart = first.slots.filter(function (id) { return !(byId[id] && byId[id].starter); });
        if (wrongStart.length) issues.push({ type: "starters", tick: 0, ids: wrongStart });
        const wrongClose = [];
        segments.forEach(function (seg) {
            if (seg.end <= L) return;
            seg.slots.forEach(function (id) {
                if (!(byId[id] && byId[id].closer) && wrongClose.indexOf(id) === -1) wrongClose.push(id);
            });
        });
        if (wrongClose.length) issues.push({ type: "closers", tick: L, ids: wrongClose });

        for (let k = 1; k < segments.length; k++) {
            const t = segments[k].start;
            if (t % rules.periodTicks === 0) continue;
            const prev = segments[k - 1].slots;
            const ins = segments[k].slots.filter(function (id) { return prev.indexOf(id) === -1; });
            if (ins.length > rules.maxSubs) issues.push({ type: "too-many-subs", tick: t, count: ins.length });
        }

        // Stints: a run of consecutive segments containing the player.
        Object.keys(byId).forEach(function (id) {
            let start = -1;
            for (let k = 0; k <= segments.length; k++) {
                const isOn = k < segments.length && segments[k].slots.indexOf(id) !== -1;
                if (isOn && start === -1) start = segments[k].start;
                if (!isOn && start !== -1) {
                    const end = segments[k - 1].end;
                    if (end - start < rules.minStint) {
                        issues.push({ type: "short-stint", tick: start, ids: [id], length: end - start });
                    }
                    start = -1;
                }
            }
        });
        issues.sort(function (a, b) { return a.tick - b.tick; });
        return issues;
    }

    // Is there any group of five among `idx` that covers 1–5?
    function anyFill(idx, posMasks) {
        // Bipartite matching positions → players.
        const matchOf = new Array(posMasks.length).fill(-1);
        function tryPos(pos, seen) {
            for (let k = 0; k < idx.length; k++) {
                const i = idx[k];
                if (!(posMasks[i] & (1 << pos)) || seen[i]) continue;
                seen[i] = true;
                if (matchOf[i] === -1 || tryPos(matchOf[i], seen)) {
                    matchOf[i] = pos;
                    return true;
                }
            }
            return false;
        }
        for (let pos = 0; pos < NPOS; pos++) {
            if (!tryPos(pos, {})) return false;
        }
        return true;
    }

    // A short explanation of who plays what, for error messages.
    function coverageHint(idx, players, posMasks) {
        const parts = [];
        for (let pos = 0; pos < NPOS; pos++) {
            const who = idx.filter(function (i) { return posMasks[i] & (1 << pos); });
            if (who.length === 0) {
                parts.push("nobody plays " + (pos + 1));
            } else if (who.length <= 2) {
                parts.push((pos + 1) + ": only " + who.map(function (i) { return players[i].name || "?"; }).join(" & "));
            }
        }
        return parts.length ? "(" + parts.join("; ") + ")" : "";
    }

    function listNames(list) {
        return list.map(function (p) { return p.name || "A player"; }).join(", ");
    }


    // For each segment choose who plays which position, keeping players at the
    // same position from one shift to the next where possible (DP over shifts).
    function assignPositions(on, posMasks, S, rng) {
        const options = on.map(function (list) { return allFills(list, posMasks); });
        const best = [];  // best[s][k] = min cost ending with options[s][k]
        const back = [];
        for (let s = 0; s < S; s++) {
            best.push(new Array(options[s].length));
            back.push(new Array(options[s].length));
            for (let k = 0; k < options[s].length; k++) {
                const noise = rng() * 0.01;
                if (s === 0) { best[s][k] = noise; back[s][k] = -1; continue; }
                let min = Infinity, arg = -1;
                for (let j = 0; j < options[s - 1].length; j++) {
                    const c = best[s - 1][j] + moves(options[s - 1][j], options[s][k]);
                    if (c < min) { min = c; arg = j; }
                }
                best[s][k] = min + noise;
                back[s][k] = arg;
            }
        }
        let k = 0;
        for (let j = 1; j < best[S - 1].length; j++) if (best[S - 1][j] < best[S - 1][k]) k = j;
        const out = new Array(S);
        const choice = new Array(S);
        for (let s = S - 1; s >= 0; s--) {
            choice[s] = k;
            out[s] = options[s][k];
            k = back[s][k];
        }

        // The DP only compares neighbouring shifts. Also try to bring a
        // player back from the bench at the position they last played:
        // sweep the shifts, re-choosing each one's positions against the
        // player's previous and next appearance, until nothing improves.
        const GAP = 0.6; // a change across a bench stint counts a bit less
        function localCost(s, opt) {
            let c = 0;
            for (let pos = 0; pos < NPOS; pos++) {
                const i = opt[pos];
                for (let dir = -1; dir <= 1; dir += 2) {
                    for (let t = s + dir, gap = false; t >= 0 && t < S; t += dir, gap = true) {
                        const at = out[t].indexOf(i);
                        if (at === -1) continue;
                        if (at !== pos) c += gap ? GAP : 1;
                        break;
                    }
                }
            }
            return c;
        }
        for (let sweep = 0; sweep < 10; sweep++) {
            let changed = false;
            for (let s = 0; s < S; s++) {
                let bestK = choice[s], bestC = localCost(s, out[s]);
                for (let k2 = 0; k2 < options[s].length; k2++) {
                    const c = localCost(s, options[s][k2]);
                    if (c < bestC - 1e-9) { bestC = c; bestK = k2; }
                }
                if (bestK !== choice[s]) {
                    choice[s] = bestK;
                    out[s] = options[s][bestK];
                    changed = true;
                }
            }
            if (!changed) break;
        }
        return out;
    }

    // How many players stay on the floor but switch positions.
    function moves(prev, next) {
        let c = 0;
        for (let pos = 0; pos < NPOS; pos++) {
            const i = next[pos];
            const was = prev.indexOf(i);
            if (was !== -1 && was !== pos) c++;
        }
        return c;
    }

    const api = { plan: plan, check: check, scaleShares: scaleShares, NPOS: NPOS };
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    else root.RotationEngine = api;
})(typeof window !== "undefined" ? window : this);
