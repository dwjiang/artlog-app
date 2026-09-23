# Letterbox parity fixture

`test-painting-512.png` is `scripts/data/pipeline/letterbox.py` applied at size 512 to
`scripts/data/fixtures/test-painting.jpg` (Vincent van Gogh, _Wheat Field with Cypresses_, The Met,
CC0). It is the reference the phone's Swift letterbox (`modules/vision-rect`) must reproduce.

Regenerate after any change to `letterbox.py` or the pinned Pillow version:

```sh
cd scripts/data && uv run python -c "
from PIL import Image
from pipeline.letterbox import letterbox
letterbox(Image.open('fixtures/test-painting.jpg'), 512).save('../../shared/model/fixtures/letterbox/test-painting-512.png', optimize=True)"
```

Check a phone- or Mac-produced PNG against Python:

```sh
cd scripts/data && uv run python letterbox-parity.py --phone <crop.png> --source fixtures/test-painting.jpg --size 512
```
