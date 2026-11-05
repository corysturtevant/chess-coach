# Player ratings: research and proposed approach

Researched November 5, 2026. Profiles now retain games, move grades, review responses,
opponent settings, handicaps, and hint/question/undo counts. This release does not assign
an Elo estimate. Existing historical games may lack assistance metadata.

## Options

| Method | Inputs | Fit for Chess Coach |
|---|---|---|
| Elo | Result and both players' ratings | Simple internal family ladder; easy to explain, but does not explicitly model uncertainty. |
| Glicko-2 | Results, opponent ratings, rating deviation and volatility | Better candidate for provisional ratings and uncertainty; needs enough games and carefully chosen rating periods. |
| Calibrated bot performance | Results against empirically calibrated, fixed bot configurations | Could provide an anchor beyond two family members, but our difficulty labels are not established Elo ratings. |
| Move-quality model | Engine analysis plus a representative dataset of games from known-rated humans | Could estimate a range after validation; average centipawn loss alone is not a conversion to Elo. |

Elo changes a rating according to actual score minus expected score, scaled by a development
factor: `new = old + K × (score − expected)`. Wins score 1, draws 0.5, losses 0.
FIDE's published regulations illustrate outcome-based rating and development factors;
using a similar calculation does not produce an official FIDE rating.
[Source: FIDE regulations effective March 2024](https://handbook.fide.com/chapter/B022024).

Glicko-2 tracks rating, rating deviation (uncertainty), and volatility. Glickman's paper
suggests reporting a range of approximately rating ± twice the deviation. It also says
rating periods work best with roughly 10–15 games per player on average. Sparse family
play needs cautious expectations, not a falsely precise number.
[Source: Mark Glickman's Glicko-2 specification](https://glicko.net/glicko/glicko2.pdf).

Stockfish's `UCI_Elo` calibration is tied to specific testing conditions (120 seconds plus
1 second per move and a CCRL anchor). Our application uses its own depth/selection settings;
“Beginner” therefore cannot simply be relabeled “1200 Elo.” Engine evaluation describes a
position, not the human's rating. Maia's conditioning settings likewise need empirical
validation before serving as fixed rating anchors in this app.
[Source: Stockfish UCI documentation](https://official-stockfish.github.io/docs/stockfish-wiki/UCI-Protocol-and-Stockfish-Commands.html).

## Recommendation

Start with saved history and improvement trends: missed tactics, move-quality distribution,
and review themes. A later release can add a **provisional Chess Coach rating**, preferably
Glicko-2 with visible uncertainty, for eligible completed games. Keep it distinct from FIDE,
Chess.com and Lichess ratings.

For Cory versus Oliver, an isolated two-person ladder mainly describes relative results.
It cannot establish absolute playing strength without an external anchor. That is a design
inference, not a limitation solved by choosing a more complicated rating formula.

Before rating games:

1. Persist an explicit final result, termination reason, finish time, immutable participants,
   engine version/settings and rating-system version. Current snapshots store PGN, status,
   player settings and assistance counts; finish metadata still needs a dedicated schema.
2. Separate unassisted standard games from lessons, handicaps, hints, questions and takebacks.
   Decide whether real-time move ratings themselves make a game assisted. Never retroactively
   treat missing assistance metadata as proof of unassisted play.
3. Choose and test rating periods and provisional thresholds using actual play frequency.
   Exclude incomplete games, and rate each game exactly once, including shared games visible
   in both histories.
4. Validate predictions on held-out outcomes before displaying narrow rating ranges. If bots
   are used as anchors, calibrate their exact configuration and repeat after engine changes.
5. For a move-based strength estimate, train and validate on known-rated human games with
   position difficulty, game phase and time format accounted for. Until then, present move
   quality as move quality.

Full interactive guided replay is separate from the saved review text viewer introduced
with profiles. Stable game IDs and stored PGN/grades provide the foundation for that work.
