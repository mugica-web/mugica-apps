// Hoops Rotation — the planning engine. No DOM, no Firebase: the page calls
// RotationEngine.plan(...) and Node can load it for testing.
//
// The game is cut into S equal shifts (periods × (subs per period + 1)).
// Every shift has exactly one player at each position 1–5. Shift 1 is the
// starting five, the last shift is the closing five.
//
// Three stages:
//   1. Targets: each player's percent is scaled so the team totals 500%
//      (5 players on the floor), nobody above 100%. Target shifts = share × S.
//   2. Shift counts: a min-cost flow picks how many shifts each player gets,
//      minimising Σ (count − target)² while every shift can still be filled
//      1–5 with eligible players and starters/closers are respected.
//   3. Arrangement: a local search moves shifts around (keeping each count)
//      so each player's time is spread evenly through the game, then a
//      dynamic program picks positions so players change spots as little
//      as possible from one shift to the next.

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

    // ---- Stage 2: shift counts by min-cost flow ----
    //
    // source → player (one arc per extra shift, with increasing cost)
    //        → (player, shift) cap 1
    //        → (shift, position) cap 1, if the player plays that position
    //        → sink cap 1
    // A full flow (5 per shift) is a legal schedule; its cost is
    // Σ (count − target)² up to a constant.

    function MinCostFlow(n) {
        this.n = n;
        this.graph = [];
        for (let i = 0; i < n; i++) this.graph.push([]);
        this.edges = []; // {to, cap, cost}
    }
    MinCostFlow.prototype.addEdge = function (u, v, cap, cost) {
        this.graph[u].push(this.edges.length);
        this.edges.push({ to: v, cap: cap, cost: cost });
        this.graph[v].push(this.edges.length);
        this.edges.push({ to: u, cap: 0, cost: -cost });
        return this.edges.length - 2;
    };
    // Successive shortest paths (SPFA handles the negative arc costs).
    MinCostFlow.prototype.run = function (s, t) {
        const n = this.n, E = this.edges, G = this.graph;
        let flow = 0;
        const EPS = 1e-9;
        for (;;) {
            const dist = new Array(n).fill(Infinity);
            const inQ = new Array(n).fill(false);
            const prevEdge = new Array(n).fill(-1);
            dist[s] = 0;
            const q = [s];
            inQ[s] = true;
            let head = 0;
            while (head < q.length) {
                const u = q[head++];
                inQ[u] = false;
                const adj = G[u];
                for (let k = 0; k < adj.length; k++) {
                    const e = E[adj[k]];
                    if (e.cap > 0 && dist[u] + e.cost < dist[e.to] - EPS) {
                        dist[e.to] = dist[u] + e.cost;
                        prevEdge[e.to] = adj[k];
                        if (!inQ[e.to]) { inQ[e.to] = true; q.push(e.to); }
                    }
                }
            }
            if (dist[t] === Infinity) break;
            // Every arc into the sink has capacity 1, so push 1 unit.
            let v = t;
            while (v !== s) {
                const id = prevEdge[v];
                E[id].cap -= 1;
                E[id ^ 1].cap += 1;
                v = E[id ^ 1].to;
            }
            flow += 1;
        }
        return flow;
    };

    // ---- Main entry point ----

    // plan({ players, shifts, seed })
    //   players: [{ id, name, pct, positions: [1..5], starter, closer }]
    //            (only the players who are at the game)
    //   shifts:  number of equal shifts in the game
    //   seed:    any integer; a different seed gives a different arrangement
    //            with the same shift counts
    // Returns { ok: true, lineups, counts, targets, shares }
    //   lineups[s] = [id at 1, id at 2, ..., id at 5]
    //   counts[id] = shifts planned, targets[id] = target shifts (fractional)
    // or { ok: false, errors: [strings] }.
    function plan(opts) {
        const players = opts.players || [];
        const S = opts.shifts;
        const rng = makeRng(opts.seed == null ? 1 : opts.seed);
        const errors = [];

        if (!(S >= 1)) errors.push("The game needs at least one shift.");
        if (players.length < NPOS) {
            errors.push("Only " + players.length + " player" + (players.length === 1 ? "" : "s") +
                " at the game. You need at least 5.");
        }
        const noPos = players.filter(function (p) { return !p.positions || p.positions.length === 0; });
        if (noPos.length) {
            errors.push(listNames(noPos) + (noPos.length === 1 ? " has" : " have") +
                " no positions selected.");
        }
        const starters = players.filter(function (p) { return p.starter; });
        const closers = players.filter(function (p) { return p.closer; });
        if (starters.length !== NPOS) {
            errors.push("Pick exactly 5 starters (" + starters.length + " picked).");
        }
        if (closers.length !== NPOS) {
            errors.push("Pick exactly 5 closers (" + closers.length + " picked).");
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
        if (S === 1 && starterIdx.join() !== closerIdx.join()) {
            errors.push("With only one shift, the starters and closers have to be the same five.");
        }
        if (errors.length) return { ok: false, errors: errors };

        // Which shifts may player i play?
        function allowed(i, s) {
            if (s === 0 && !players[i].starter) return false;
            if (s === S - 1 && !players[i].closer) return false;
            return true;
        }

        // Middle shifts can use anyone: check the whole group can cover 1–5.
        if (S >= 3 && !anyFill(idx, posMasks)) {
            return { ok: false, errors: ["No five players at this game can cover 1–5. " +
                coverageHint(idx, players, posMasks)] };
        }

        const shares = scaleShares(players.map(function (p) { return p.pct; }));
        const targets = shares.map(function (x) { return x * S; });

        // Build the flow network.
        const SRC = 0;
        const P0 = 1;                      // player nodes
        const PS0 = P0 + n;                // (player, shift) nodes
        const SP0 = PS0 + n * S;           // (shift, position) nodes
        const SINK = SP0 + S * NPOS;
        const mcf = new MinCostFlow(SINK + 1);

        const psEdge = []; // psEdge[i][s] = edge id player→(player, shift)
        for (let i = 0; i < n; i++) {
            let avail = 0;
            psEdge.push([]);
            for (let s = 0; s < S; s++) {
                if (allowed(i, s)) {
                    avail++;
                    psEdge[i][s] = mcf.addEdge(P0 + i, PS0 + i * S + s, 1, 0);
                    for (let pos = 0; pos < NPOS; pos++) {
                        if (posMasks[i] & (1 << pos)) {
                            mcf.addEdge(PS0 + i * S + s, SP0 + s * NPOS + pos, 1, 0);
                        }
                    }
                } else {
                    psEdge[i][s] = -1;
                }
            }
            // The k-th shift for player i adds (k − T)² − (k − 1 − T)² = 2k − 1 − 2T.
            // A tiny index-based term breaks exact ties the same way every time.
            for (let k = 1; k <= avail; k++) {
                mcf.addEdge(SRC, P0 + i, 1, 2 * k - 1 - 2 * targets[i] + 1e-7 * (i + 1) * k);
            }
        }
        for (let s = 0; s < S; s++) {
            for (let pos = 0; pos < NPOS; pos++) {
                mcf.addEdge(SP0 + s * NPOS + pos, SINK, 1, 0);
            }
        }
        const flow = mcf.run(SRC, SINK);
        if (flow < S * NPOS) {
            return { ok: false, errors: ["Couldn't fill 1–5 in every shift with these players. " +
                coverageHint(idx, players, posMasks)] };
        }

        // Read the schedule: on[s] = sorted list of players on the floor.
        const on = [];
        for (let s = 0; s < S; s++) on.push([]);
        for (let i = 0; i < n; i++) {
            for (let s = 0; s < S; s++) {
                const id = psEdge[i][s];
                if (id >= 0 && mcf.edges[id].cap === 0) on[s].push(i);
            }
        }
        const counts = new Array(n).fill(0);
        on.forEach(function (list) { list.forEach(function (i) { counts[i]++; }); });

        // ---- Stage 3a: spread each player's shifts through the game ----
        improveSpread(on, counts, posMasks, S, n, rng);

        // ---- Stage 3b: positions ----
        const lineups = assignPositions(on, posMasks, S, rng);

        // Explain the most common reason a player is far off target.
        const warnings = [];
        for (let pos = 0; pos < NPOS; pos++) {
            const who = idx.filter(function (i) { return posMasks[i] & (1 << pos); });
            if (who.length === 1) {
                const name = players[who[0]].name || "One player";
                warnings.push("Only " + name + " plays " + (pos + 1) + ", so " + name +
                    " plays every shift.");
            }
        }

        const result = { ok: true, lineups: [], counts: {}, targets: {}, shares: {}, warnings: warnings };
        lineups.forEach(function (lineup) {
            result.lineups.push(lineup.map(function (i) { return players[i].id; }));
        });
        players.forEach(function (p, i) {
            result.counts[p.id] = counts[i];
            result.targets[p.id] = targets[i];
            result.shares[p.id] = shares[i];
        });
        return result;
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

    // Spread penalty for one player's 0/1 row: how far their running total
    // strays from an even pace. Playing every other shift scores better than
    // playing a block and then sitting a block.
    function spreadCost(row, count, S) {
        let cum = 0, cost = 0;
        for (let s = 0; s < S; s++) {
            cum += row[s];
            const d = cum - count * (s + 1) / S;
            cost += d * d;
        }
        // Long stretches on the bench feel worse than the pace number says.
        let run = 0;
        for (let s = 0; s < S; s++) {
            if (row[s]) { run = 0; } else { run++; if (run >= 3) cost += 0.5 * (run - 2); }
        }
        return cost;
    }

    // Simulated annealing over moves that keep every count: in shift s
    // player b replaces a, and in another shift t player a replaces b.
    // Shift 1 and the last shift are fixed (starters / closers).
    function improveSpread(on, counts, posMasks, S, n, rng) {
        const free = [];
        for (let s = 1; s < S - 1; s++) free.push(s);
        if (free.length < 2) return;

        const rows = [];
        for (let i = 0; i < n; i++) rows.push(new Array(S).fill(0));
        on.forEach(function (list, s) { list.forEach(function (i) { rows[i][s] = 1; }); });
        const cost = rows.map(function (r, i) { return spreadCost(r, counts[i], S); });

        const fillCache = new Map();
        function ok(list) {
            const key = list.slice().sort(function (a, b) { return a - b; }).join(",");
            let v = fillCache.get(key);
            if (v === undefined) { v = canFill(list, posMasks); fillCache.set(key, v); }
            return v;
        }

        const ITER = 40000;
        let temp = 2.0;
        const cool = Math.pow(0.002 / temp, 1 / ITER);
        for (let it = 0; it < ITER; it++, temp *= cool) {
            const s = free[Math.floor(rng() * free.length)];
            const a = on[s][Math.floor(rng() * NPOS)];
            const b = Math.floor(rng() * n);
            if (rows[b][s]) continue;
            // Shifts where b plays and a doesn't.
            const cands = [];
            for (let k = 0; k < free.length; k++) {
                const t = free[k];
                if (t !== s && rows[b][t] && !rows[a][t]) cands.push(t);
            }
            if (!cands.length) continue;
            const t = cands[Math.floor(rng() * cands.length)];

            const newS = on[s].map(function (x) { return x === a ? b : x; });
            const newT = on[t].map(function (x) { return x === b ? a : x; });
            if (!ok(newS) || !ok(newT)) continue;

            rows[a][s] = 0; rows[a][t] = 1;
            rows[b][t] = 0; rows[b][s] = 1;
            const ca = spreadCost(rows[a], counts[a], S);
            const cb = spreadCost(rows[b], counts[b], S);
            const delta = ca + cb - cost[a] - cost[b];
            if (delta <= 0 || rng() < Math.exp(-delta / temp)) {
                cost[a] = ca; cost[b] = cb;
                on[s] = newS; on[t] = newT;
            } else {
                rows[a][s] = 1; rows[a][t] = 0;
                rows[b][t] = 1; rows[b][s] = 0;
            }
        }
    }

    // For each shift choose who plays which position, keeping players at the
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

    const api = { plan: plan, scaleShares: scaleShares, NPOS: NPOS };
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    else root.RotationEngine = api;
})(typeof window !== "undefined" ? window : this);
