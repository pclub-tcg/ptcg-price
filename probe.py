import json,subprocess,sys
subprocess.run([sys.executable,"-m","pip","install","-q","opencc-python-reimplemented"],check=True)
from opencc import OpenCC
cc=OpenCC("s2twp");d=json.load(open("in.json"))
out={k:{n:cc.convert(z) for n,z in v.items()} for k,v in d.items()}
json.dump(out,open("/tmp/o/setnames.json","w"),ensure_ascii=False,indent=0);print("ok")
