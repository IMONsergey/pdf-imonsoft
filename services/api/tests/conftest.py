from pathlib import Path
import sys
import pytest
from reportlab.pdfgen import canvas
from PIL import Image
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import Settings

@pytest.fixture
def settings(tmp_path):
    return Settings(data_dir=tmp_path / 'data', office_engine='local', libreoffice_bin='/usr/bin/libreoffice')

@pytest.fixture
def sample_pdf(tmp_path):
    path = tmp_path / 'sample.pdf'
    pdf = canvas.Canvas(str(path), pagesize=(720, 405))
    for i in range(3):
        pdf.setFillColorRGB(.95,.96,.99); pdf.rect(0,0,720,405,fill=1,stroke=0)
        pdf.setFillColorRGB(.1,.2,.9); pdf.rect(30,25,100+60*i,80,fill=1,stroke=0)
        pdf.setFillColorRGB(.07,.1,.15); pdf.setFont('Helvetica',28)
        pdf.drawString(40,300,f'IMONSOFT page {i+1}'); pdf.showPage()
    pdf.save()
    return path

@pytest.fixture
def sample_image(tmp_path):
    path=tmp_path/'image.png'; Image.new('RGBA',(320,200),(20,100,220,150)).save(path)
    return path
