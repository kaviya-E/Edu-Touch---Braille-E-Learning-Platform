# braille_converter.py

from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from indic_transliteration import sanscript
from indic_transliteration.sanscript import transliterate
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.pagesizes import letter
import tempfile


# ================= BRAILLE MAP =================

BRAILLE_MAP = {
    'a': '⠁', 'b': '⠃', 'c': '⠉', 'd': '⠙', 'e': '⠑',
    'f': '⠋', 'g': '⠛', 'h': '⠓', 'i': '⠊', 'j': '⠚',
    'k': '⠅', 'l': '⠇', 'm': '⠍', 'n': '⠝', 'o': '⠕',
    'p': '⠏', 'q': '⠟', 'r': '⠗', 's': '⠎', 't': '⠞',
    'u': '⠥', 'v': '⠧', 'w': '⠺', 'x': '⠭', 'y': '⠽',
    'z': '⠵',

    '1': '⠼⠁', '2': '⠼⠃', '3': '⠼⠉', '4': '⠼⠙', '5': '⠼⠑',
    '6': '⠼⠋', '7': '⠼⠛', '8': '⠼⠓', '9': '⠼⠊', '0': '⠼⠚',

    ' ': ' ',

    '.': '⠲', ',': '⠂', '?': '⠦', '!': '⠖', ';': '⠆',
    ':': '⠒', '-': '⠤', '(': '⠐⠣', ')': '⠐⠜',

    '\n': '\n'
}


TAMIL_BRAILLE_MAP = {
    'அ': '⠁', 'ஆ': '⠜', 'இ': '⠊', 'ஈ': '⠔', 'உ': '⠥', 'ஊ': '⠳', 
    'எ': '⠢', 'ஏ': '⠑', 'ஐ': '⠌', 'ஒ': '⠭', 'ஓ': '⠕', 'ஔ': '⠪', 'ஃ': '⠠',
    
    'க': '⠅', 'ங': '⠬', 'ச': '⠉', 'ஞ': '⠒', 'ட': '⠾', 'ண': '⠼', 
    'த': '⠞', 'ந': '⠝', 'ப': '⠏', 'ம': '⠍', 'ய': '⠽', 'ர': '⠗', 
    'ல': '⠇', 'வ': '⠧', 'ழ': '⠷', 'ள': '⠸', 'ற': '⠯', 'ன': '⠰', 
    'ஜ': '⠜', 'ஷ': '⠩', 'ஸ': '⠎', 'ஹ': '⠓',
    
    'ா': '⠜', 'ி': '⠊', 'ீ': '⠔', 'ு': '⠥', 'ூ': '⠳', 
    'ெ': '⠢', 'ே': '⠑', 'ை': '⠌', 'ொ': '⠭', 'ோ': '⠕', 'ௌ': '⠪',
    '்': '⠈', # Virama / Pulli
    
    '1': '⠼⠁', '2': '⠼⠃', '3': '⠼⠉', '4': '⠼⠙', '5': '⠼⠑',
    '6': '⠼⠋', '7': '⠼⠛', '8': '⠼⠓', '9': '⠼⠊', '0': '⠼⠚',

    ' ': ' ', '\n': '\n',

    '.': '⠲', ',': '⠂', '?': '⠦', '!': '⠖', ';': '⠆',
    ':': '⠒', '-': '⠤', '(': '⠐⠣', ')': '⠐⠜'
}

# ================= TEXT TO BRAILLE =================

def text_to_braille(text, language="english"):

    if not text:
        return ""

    if language == "tamil":
        result = ""
        for char in text:
            result += TAMIL_BRAILLE_MAP.get(char, char)
        return result

    # English Logic
    # 🔥 FORCE transliteration (Retained for legacy logic)
    text = transliterate(text, sanscript.TAMIL, sanscript.ITRANS)

    # CLEAN symbols
    text = text.replace("^", "").replace("~", "")

    # NORMALIZE
    text = (
        text.replace("ā", "a")
            .replace("ī", "i")
            .replace("ū", "u")
            .replace("ē", "e")
            .replace("ō", "o")
            .replace("ṅ", "n")
            .replace("ñ", "n")
            .replace("ṭ", "t")
            .replace("ṇ", "n")
            .replace("ḷ", "l")
            .replace("ḻ", "l")
            .replace("ṟ", "r")
    )

    result = ""

    for char in text.lower():
        result += BRAILLE_MAP.get(char, char)

    return result

import os

# ================= BRAILLE PDF GENERATION =================

def create_braille_pdf(braille_text):

    # 🔥 ADD FONT SUPPORT (IMPORTANT)
    font_path = os.path.join(os.path.dirname(__file__), "DejaVuSans.ttf")   # keep this file in project folder
    pdfmetrics.registerFont(TTFont('DejaVu', font_path))

    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".pdf")

    c = canvas.Canvas(temp_file.name)

    # 🔥 USE BRAILLE SUPPORTED FONT
    c.setFont("DejaVu", 18)

    start_x = 50
    start_y = 750

    cell_spacing = 12
    line_spacing = 30

    max_cells = 40

    y = start_y

    for paragraph in braille_text.split("\n"):

        lines = [paragraph[i:i+max_cells] for i in range(0, len(paragraph), max_cells)]

        for line in lines:

            x = start_x

            for ch in line:
                c.drawString(x, y, ch)
                x += cell_spacing

            y -= line_spacing

            if y < 50:
                c.showPage()

                # 🔥 RE-SET FONT AFTER PAGE BREAK
                c.setFont("DejaVu", 18)

                y = start_y

    c.save()

    return temp_file.name

def save_as_brf(braille_text):

    file_path = "output.brf"

    with open(file_path, "w", encoding="utf-8") as f:
        f.write(braille_text)

    return file_path

# ================= TEST FUNCTION =================

def test_converter():
    test_text = "Hello World"

    braille = text_to_braille(test_text)

    print("Original:", test_text)
    print("Braille:", braille)


if __name__ == "__main__":
    test_converter()