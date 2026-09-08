from PIL import Image,ImageOps,ImageDraw
from pathlib import Path
R=Path(__file__).resolve().parents[1]/'references'
files=[p for p in R.glob('*.jpg') if 'contact' not in p.name]
W,H=400,270
out=Image.new('RGB',(W*4,H*((len(files)+3)//4)), '#16232d'); draw=ImageDraw.Draw(out)
for i,p in enumerate(files):
 im=Image.open(p).convert('RGB');im.thumbnail((W,H-28))
 x=(i%4)*W;y=(i//4)*H
 out.paste(im,(x+(W-im.width)//2,y));draw.text((x+8,y+H-24),p.stem[:12],fill='white')
out.save(R/'image_contact.jpg')
