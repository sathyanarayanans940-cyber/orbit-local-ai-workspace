"""Independent Jupyter validation of generated synthetic files; never execute cells."""
from pathlib import Path
import json, zipfile, nbformat

root=Path(__file__).parent/'output/notebooks'
checked=[]
def check(name,data):
    book=json.loads(data)
    nbformat.validate(book)
    assert book['nbformat']==4 and book['nbformat_minor']==5
    assert len({cell['id'] for cell in book['cells']})==len(book['cells'])
    for cell in book['cells']:
        if cell['cell_type']=='code':
            assert cell['outputs']==[] and cell['execution_count'] is None
    checked.append(name)
for file in sorted(root.glob('*.ipynb')):check(file.name,file.read_bytes())
with zipfile.ZipFile(root/'notebooks.zip') as archive:
    assert archive.testzip() is None
    for name in archive.namelist():
        if name.endswith('.ipynb'):
            check('ZIP:'+name,archive.read(name))
            assert archive.read(name)==(root/Path(name).name).read_bytes()
report={'validator':'jupyter/nbformat '+nbformat.__version__,'checked':checked,'notebooks':len(checked),'executed':False}
(root/'nbformat-validation.json').write_text(json.dumps(report,indent=2))
print(f'PASS: {len(checked)} notebook files validated with nbformat {nbformat.__version__}; ZIP copies match originals.')
