# Letterbox parity fixture

`test-painting-512.png` is `jobs/artlog_jobs/letterbox.py` applied at size 512 to
`jobs/fixtures/test-painting.jpg` (Vincent van Gogh, *Wheat Field with Cypresses*, The Met,
CC0). It is the reference the phone's Swift letterbox (`modules/vision-rect`) must reproduce.

Regenerate after any change to `letterbox.py` or the pinned Pillow version:

```sh
cd jobs && uv run python -c "
from PIL import Image
from artlog_jobs.letterbox import letterbox
letterbox(Image.open('fixtures/test-painting.jpg'), 512).save('../shared/fixtures/letterbox/test-painting-512.png', optimize=True)"
```

Check a phone- or Mac-produced PNG against Python:

```sh
cd jobs && uv run python scripts/letterbox-parity.py --phone <crop.png> --source fixtures/test-painting.jpg --size 512
```
