"""Regenerate the existing LabPad mark for desktop packaging (Pillow + ImageMagick)."""
from pathlib import Path
import subprocess
from PIL import Image
assets=Path(__file__).resolve().parents[1]/'assets'
subprocess.run(['convert','-background','none',str(assets/'icon.svg'),str(assets/'icon.png')],check=True)
with Image.open(assets/'icon.png') as image:
    image.save(assets/'icon.ico',sizes=[(n,n) for n in [16,24,32,48,64,128,256]])
    image.save(assets/'icon.icns')
print('Generated LabPad PNG, ICO and ICNS icons')
