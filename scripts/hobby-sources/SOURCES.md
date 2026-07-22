# Hobby catalog sources

Snapshots fetched **2026-07-22** via the MediaWiki API
(`https://en.wikipedia.org/w/api.php?action=parse&page=<title>&prop=wikitext&format=json&formatversion=2&redirects=1`).
Committed so `npm run generate:hobbies` is offline-reproducible. To refresh a
snapshot, re-run the same URL with the page title below and overwrite the file.

| File | Wikipedia page | Default category |
|---|---|---|
| List_of_sports.json | List of sports | sports |
| List_of_water_sports.json | List of water sports | sports |
| List_of_martial_arts.json | List of martial arts | sports |
| List_of_dance_styles.json | List of dance styles | arts |
| List_of_musical_instruments.json | List of musical instruments | music |
| List_of_cuisines.json | List of cuisines | food |
| List_of_board_games.json | List of board games | gaming |
| Outline_of_games.json | Outline of games | gaming |
| Outline_of_crafts.json | Outline of crafts | crafts |
| List_of_collectables.json | List of collectables | collecting |

Additionally `scripts/interests_seed.json` (this repo's curated 305-interest
seed, 9 categories) is merged in first, so its names win deduplication.

Note: Wikipedia's "List of hobbies" page no longer exists (checked 2026-07-22);
general-hobby coverage comes from the seed file plus the curated alias table in
`scripts/generate-hobby-catalog.mjs`.
