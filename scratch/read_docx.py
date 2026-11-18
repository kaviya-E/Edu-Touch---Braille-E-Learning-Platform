from docx import Document
import os

files = ["Why Braille Files Are Not Supported by Standard Audio Players.docx", "Popular social media platforms with over 100 million registered users include Twitter.docx"]

for f in files:
    if os.path.exists(f):
        print(f"--- CONTENT OF {f} ---")
        doc = Document(f)
        for p in doc.paragraphs:
            print(p.text)
        print("\n")
