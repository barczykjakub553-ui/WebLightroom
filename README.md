# WebLightroom

Przeglądarkowy klon Adobe Lightroom Classic: katalog zdjęć i nieniszczący edytor („develop”) działający w całości na GPU (WebGL2). Nie ma zależności ani kroku budowania — to czysty HTML/CSS/JS.

## Uruchomienie

```bash
python serve.py 8765
```

Potem otwórz http://localhost:8765. Plik `index.html` można też otworzyć bezpośrednio z dysku, ale serwer jest pewniejszy.

Zdjęcia, edycje, kolekcje i presety zapisują się w IndexedDB przeglądarki (lokalnie, nic nie jest wysyłane).

## Funkcje

**Library**
- Import przez przycisk, folder albo drag & drop (JPEG, PNG, WebP, AVIF, GIF, BMP), odczyt EXIF
- Siatka (Grid) i Loupe, filmstrip, nakładka info (I), zoom i przesuwanie
- Oceny 0–5, flagi Pick/Reject, kolorowe etykiety, Quick Collection, kolekcje (przeciągnij zdjęcia na kolekcję)
- Library Filter: tekst, flaga, ocena (≥ / = / ≤), etykieta, edytowane/nieedytowane; sortowanie
- Quick Develop, słowa kluczowe, metadane (tytuł, opis), wirtualne kopie, synchronizacja ustawień i metadanych

**Develop**
- Basic: Treatment (Color / B&W), balans bieli (As Shot / Auto / Custom + pipeta), Exposure, Contrast, Highlights, Shadows, Whites, Blacks, Texture, Clarity, Dehaze, Vibrance, Saturation, Auto Tone
- Tone Curve: parametryczna (z przesuwanymi podziałami regionów) i punktowa RGB / R / G / B
- HSL / Color (Hue / Saturation / Luminance / All) oraz B&W Mix
- Color Grading: koła Shadows / Midtones / Highlights / Global, Blending, Balance
- Detail: Sharpening (Amount, Radius, Detail, Masking), Noise Reduction (Luminance, Color)
- Lens Corrections: Distortion, Vignetting; Effects: Post-Crop Vignetting, Grain
- Crop & Straighten: proporcje, blokada, prostowanie przez przeciąganie, obrót o 90°, odbicia
- Maski: gradient liniowy i radialny z lokalnymi korektami, odwracaniem, wtapianiem i nakładką
- Histogram na żywo, ostrzeżenia o przepaleniach (J), Before/After (\) i widok obok siebie (Y)
- Historia z undo/redo, snapshoty, presety wbudowane i własne (z podglądem po najechaniu w Navigatorze), Copy/Paste ustawień
- Ponad 400 wbudowanych presetów (`js/presets.js`) z wyszukiwarką: Film, Cinematic, Portrait, Landscape, Urban & Street, Travel & Lifestyle, Vintage, Seasons, Food & Product, Wedding, Creative, Black & White (każdy look w wersjach Light / normalnej / Strong) oraz presety narzędziowe Basic · Tone / Color / Detail / Effects / Curve
- Export: JPEG / PNG / WebP, jakość, zmiana rozmiaru, wyostrzanie wyjściowe, znak wodny, szablony nazw, zapis do wybranego folderu

Pełną listę skrótów pokazuje `?` w aplikacji.

## Struktura

| Plik | Rola |
|---|---|
| `js/engine.js` | Silnik WebGL2: shader z całym pipeline'em, rozmycia, LUT krzywych |
| `js/settings.js` | Model ustawień, krzywe, wbudowane presety |
| `js/catalog.js` | Katalog: import, miniatury, filtry, kolekcje, copy/paste/sync |
| `js/viewer.js` | Podgląd: zoom/pan, before/after, transformacje współrzędnych |
| `js/tools.js` | Narzędzia Crop, Masking, pipeta WB, Auto Tone |
| `js/widgets.js` | Edytor krzywej tonalnej, koła Color Grading |
| `js/develop.js`, `js/library.js` | Moduły UI |
| `js/export.js` | Dialog i render eksportu w pełnej rozdzielczości |
| `js/app.js` | Powłoka: layout, filmstrip, menu, skróty klawiszowe |

## Ograniczenia

- Pliki RAW (CR2, NEF, ARW, DNG…) nie są obsługiwane: przeglądarka nie dekoduje ich natywnie.
- Podgląd jest ograniczony do 4096 px po dłuższym boku; eksport do 8192 px (albo do limitu tekstur GPU, jeśli jest niższy).
- Do eksportu nie są dopisywane metadane EXIF.
- Nie ma narzędzi Healing / Red Eye ani modułów Map / Book / Print.
