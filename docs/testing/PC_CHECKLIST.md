# Testing on the Windows PC

The Mac generates the invented CVs and runs every automated check. The PC does what only real Windows software and a real person can do. Every file is invented; never put a real person's CV into this set.

## 1. Real Word output (most valuable)

You will receive a folder of `.docx` files from `sample-documents/factory`. For each one:

1. Open it in Microsoft Word on the PC.
2. **Save As** a new Word file in a folder called `word-resaved`, keeping the same name but ending in `-resaved.docx`.
3. **Save As PDF** (File > Save As > PDF) into a folder called `word-pdf`, same name, ending in `-word.pdf`.

Do not change any wording. Real recruiters receive files exactly like these, and Word stores them differently inside from the ones the Mac makes.

## 2. Real scans (if you have a printer and scanner)

1. Print about ten of the PDFs (any mix).
2. Scan them back as PDF at an ordinary office setting (200 to 300 dpi, black and white or greyscale) into a folder called `scanned`, same name, ending in `-scan.pdf`.
3. Optional and useful: photograph two or three pages with a phone, as a candidate might, ending in `-photo.jpg`.

## 3. Bring them back

Copy the three folders to the Mac, into `sample-documents/factory-pc/` (create it). The answer keys stay where they are; the files are matched to them by name. Then Claude runs `npm run factory:eval` against them and reports what breaks.

## 4. Later: hands-on in RoleMatch on Windows

Once RoleMatch is reachable from the PC (it currently runs only on the Mac), upload a few of these files as a recruiter would and note anything that looks wrong or confusing: a field in the wrong place, a match that makes no sense, a message you would not understand. Write each down with the file name. Those notes become test cases.
