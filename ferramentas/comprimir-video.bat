@echo off
chcp 65001 >nul
rem ---------------------------------------------------------------------------------------------------------
rem  Loja do Ligeiro: deixa o video pronto para entregar pela Central.
rem  Como usar: ARRASTE o video (do CapCut, do celular, de onde for) em cima deste arquivo.
rem  Sai um "<nome>-ligeiro.mp4" do lado do original: vertical 720x1280, ate 20 segundos, H.264 + AAC,
rem  qualidade visual igual (CRF 23) e o comeco do arquivo pronto para tocar na hora (faststart).
rem  20 segundos ficam com uns 2 a 6 MB (a Central aceita ate 15 MB). Precisa do ffmpeg (ja instalado neste PC).
rem ---------------------------------------------------------------------------------------------------------
if "%~1"=="" (
  echo Arraste o video em cima deste arquivo.
  pause
  exit /b 1
)
set "SAIDA=%~dpn1-ligeiro.mp4"
ffmpeg -v error -stats -y -i "%~1" -t 20 -vf "scale=720:1280:force_original_aspect_ratio=decrease:flags=lanczos,pad=720:1280:(ow-iw)/2:(oh-ih)/2:color=black,fps=30" -c:v libx264 -preset slow -crf 23 -maxrate 2500k -bufsize 5000k -profile:v high -pix_fmt yuv420p -c:a aac -b:a 96k -ac 2 -movflags +faststart "%SAIDA%"
if errorlevel 1 (
  echo.
  echo Nao deu para converter. Confira se o arquivo e um video.
  pause
  exit /b 1
)
for %%A in ("%SAIDA%") do echo.& echo Pronto: %%~nxA (%%~zA bytes). Entregue este arquivo pela Central.
pause
