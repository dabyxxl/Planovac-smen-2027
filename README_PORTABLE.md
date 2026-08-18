# Plánovač směn 2027

Lokální webová aplikace pro plánování směn deseti pracovníků v nepřetržitém provozu.

## Spuštění na jiném počítači s Windows

1. Rozbalte celý ZIP do běžné složky, například `Dokumenty\\Planovac-smen`.
2. Nainstalujte [Node.js 22 LTS nebo novější](https://nodejs.org/).
3. Dvakrát klikněte na `START_WINDOWS.cmd`.
4. Při prvním spuštění se stáhnou potřebné součásti. Poté se aplikace otevře na `http://localhost:3000/`.
5. Aplikaci ukončíte zavřením černého okna, ve kterém běží.

## Důležité informace o datech

Pracovníci, dovolené a záskoky se ukládají pouze do místního úložiště použitého prohlížeče. Zdrojový ZIP obsahuje aplikaci a její pravidla, ale neobsahuje data uložená v prohlížeči původního počítače.

Pro přenos aktuálního ročního plánu použijte v aplikaci kartu **Roční souhrn** a tlačítko **Export do Excelu**. Na novém počítači je potřeba dovolené a ruční úpravy zadat znovu, pokud ještě nejsou součástí zdrojového nastavení.

## Pokračování vývoje s ChatGPT nebo Codexem

- V Codexu otevřete rozbalenou složku jako projekt.
- V ChatGPT přiložte ZIP a požádejte o pokračování vývoje lokálního plánovače směn.
- Soubor `KONTEXT_PRO_CHATGPT.md` obsahuje aktuální zadání a zavedená pravidla.

## Struktura

- `app/page.tsx` – funkce aplikace a plánovací pravidla
- `app/globals.css` – vzhled a tisková podoba
- `package.json` – příkazy a potřebné součásti
- `START_WINDOWS.cmd` – jednoduché spuštění na Windows

