"""Generates synthetic resume fixtures (fictional person) used by OCR/extraction tests.

Usage: python3 infrastructure/scripts/generate-fixtures.py <out_dir>
Produces: resume.pdf (selectable text), resume-scanned.pdf (image-only, skewed + noisy),
resume-rotated.png (rotated 90deg), resume.docx
"""
import random, sys, os
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import docx

LINES = [
    ("Arjun Mehta", 20, True),
    ("Senior Software Engineer", 13, False),
    ("arjun.mehta@example.com | +91 98765 43210 | Bengaluru, India", 10, False),
    ("linkedin.com/in/arjun-mehta-dev | github.com/arjunmehta-dev", 10, False),
    ("", 10, False),
    ("SUMMARY", 12, True),
    ("Backend-focused engineer with 7 years of experience building Python and Node.js services.", 10, False),
    ("", 10, False),
    ("EXPERIENCE", 12, True),
    ("Senior Software Engineer, Northwind Labs  Jan 2021 - Present", 10, True),
    ("Led migration of billing APIs to TypeScript and PostgreSQL on AWS; cut latency by 40%.", 10, False),
    ("Software Engineer, Contoso Systems  Jul 2017 - Dec 2020", 10, True),
    ("Built REST APIs in Python with Django and Redis caching; deployed with Docker and Kubernetes.", 10, False),
    ("", 10, False),
    ("SKILLS", 12, True),
    ("Python, TypeScript, Node.js, React, Django, PostgreSQL, Redis, AWS, Docker, Kubernetes", 10, False),
    ("Communication, Mentoring, Problem Solving", 10, False),
    ("", 10, False),
    ("EDUCATION", 12, True),
    ("B.Tech in Computer Science, VIT University  2013 - 2017", 10, False),
    ("", 10, False),
    ("CERTIFICATIONS", 12, True),
    ("AWS Certified Solutions Architect - Associate (2022)", 10, False),
    ("", 10, False),
    ("PROJECTS", 12, True),
    ("JobPulse - open source job alert bot built with Python and PostgreSQL", 10, False),
]

def make_pdf(path):
    c = canvas.Canvas(path, pagesize=A4)
    w, h = A4
    y = h - 60
    for text, size, bold in LINES:
        c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
        c.drawString(50, y, text)
        y -= size + 8
    c.showPage(); c.save()

def render_image(scale=3):
    W, H = int(595 * scale), int(842 * scale)
    img = Image.new("L", (W, H), 255)
    d = ImageDraw.Draw(img)
    y = 60 * scale
    for text, size, bold in LINES:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", int(size * scale))
        d.text((50 * scale, y), text, fill=0, font=font)
        y += int((size + 8) * scale)
    return img

def scanned_pdf(path):
    img = render_image()
    img = img.rotate(2.5, expand=False, fillcolor=255, resample=Image.BICUBIC)
    random.seed(7)
    px = img.load()
    for _ in range(25000):
        x, y = random.randrange(img.width), random.randrange(img.height)
        px[x, y] = random.choice([0, 128, 200])
    img = img.filter(ImageFilter.GaussianBlur(0.6))
    img.convert("RGB").save(path, "PDF", resolution=216)

def rotated_png(path):
    img = render_image(scale=2.5).rotate(90, expand=True, fillcolor=255)
    img.save(path)

def make_docx(path):
    doc = docx.Document()
    for text, size, bold in LINES:
        p = doc.add_paragraph()
        r = p.add_run(text); r.bold = bold
    doc.save(path)

if __name__ == "__main__":
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    make_pdf(os.path.join(out, "resume.pdf"))
    scanned_pdf(os.path.join(out, "resume-scanned.pdf"))
    rotated_png(os.path.join(out, "resume-rotated.png"))
    make_docx(os.path.join(out, "resume.docx"))
    print("fixtures written to", out)
