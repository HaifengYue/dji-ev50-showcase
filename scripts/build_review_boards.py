from PIL import Image,ImageDraw,ImageFont
from pathlib import Path
P=Path(__file__).resolve().parents[1]
font=ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf',22)
small=ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf',16)
for version in ['v04','v05']:
 views=['front','rear','left','right','top','bottom','perspective']
 board=Image.new('RGB',(1600,1420),'#18252d');d=ImageDraw.Draw(board)
 d.text((28,20),f'EV50 / {version.upper()} / ORTHOGRAPHIC REVIEW',font=font,fill='#d4fa79')
 for i,name in enumerate(views):
  im=Image.open(P/'previews'/version/(name+'.png')).convert('RGB');im.thumbnail((520,390))
  x=20+(i%3)*530;y=70+(i//3)*440;board.paste(im,(x,y));d.text((x+8,y+398),name.upper(),font=small,fill='white')
 d.text((560,1060),'7.00 m span / 3.70 m length / 1.15 m height',font=font,fill='white')
 d.text((560,1100),'8 lift rotors / 3 cruise propellers',font=font,fill='white')
 d.text((560,1150),'Reference-based visual study. Not an official DJI model.',font=small,fill='#adc0cb')
 board.save(P/'previews'/version/'review_board.jpg',quality=92)
print('Review boards saved for v01, v02, v03.')
