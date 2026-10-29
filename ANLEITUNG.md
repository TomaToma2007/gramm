# Gramm – deine private Kalorien-App

## 1. Kostenlos online stellen mit GitHub Pages
1. Erstell einen kostenlosen Account auf github.com.
2. Klick oben rechts auf „+“ und dann auf „New repository“.
3. Gib als Namen `gramm` ein und wähl „Public“.
4. Klick auf „Create repository“.
5. Klick auf „uploading an existing file“.
6. Zieh alle Dateien aus dem entpackten Ordner in das Fenster.
7. Klick unten auf „Commit changes“.
8. Geh im Repository auf „Settings“ und dann links auf „Pages“.
9. Wähl bei „Branch“ den Eintrag `main` und `/ (root)`, dann „Save“.
10. Nach ein bis zwei Minuten läuft die App unter `https://DEINNAME.github.io/gramm/`.

Die Adresse nutzt HTTPS. Deshalb funktioniert dort auch die Kamera für den Barcode.

Deine Daten landen nicht auf GitHub. Sie bleiben nur auf deinem Handy.

## 2. Auf den Startbildschirm legen
- iPhone: Adresse in Safari öffnen, auf Teilen tippen, dann „Zum Home-Bildschirm“.
- Android: Adresse in Chrome öffnen, Menü öffnen, dann „App installieren“.

## 3. Foto-Erkennung einrichten
1. Geh auf console.anthropic.com und erstell einen Account.
2. Lade unter „Billing“ ein kleines Guthaben auf, zum Beispiel 5 Euro.
3. Erstell unter „API Keys“ einen neuen Schlüssel.
4. Öffne in Gramm den Reiter „Ziele“ und füg den Schlüssel bei „Foto-Erkennung“ ein.

Eine Erkennung kostet ungefähr einen bis zwei Cent.
Der Schlüssel bleibt nur auf deinem Handy. Gib ihn niemandem weiter.

## 4. Sync mit Claude einrichten
Damit Claude deine Daten lesen kann, speichert die App sie automatisch in einem privaten GitHub-Speicher.

1. Erstell auf GitHub ein zweites Repository mit dem Namen `gramm-daten`.
2. Wähl dabei unbedingt „Private“, damit nur du es sehen kannst.
3. Geh auf github.com/settings/personal-access-tokens und dann auf „Generate new token“.
4. Gib einen Namen ein, zum Beispiel `Gramm`, und wähl eine Laufzeit von einem Jahr.
5. Wähl bei „Repository access“ den Punkt „Only select repositories“ und dann `gramm-daten`.
6. Stell bei „Permissions“ den Punkt „Contents“ auf „Read and write“.
7. Klick auf „Generate token“ und kopier den Token.
8. Öffne in Gramm „Ziele“ und dann „Sync mit Claude“.
9. Trag `deinname/gramm-daten` und den Token ein.
10. Tipp auf „Jetzt synchronisieren“.

Danach speichert die App nach jeder Änderung automatisch.
Im Speicher liegen dann `gramm-daten.json` und ein lesbarer `bericht.md`.
Sag Claude einmal den Namen deines Speichers, dann kann Claude ihn lesen.

Der Token kann nur diesen einen Speicher ändern. Gib ihn trotzdem niemandem weiter.
Dein API-Schlüssel und der Token werden nie mit hochgeladen.

## 5. Backup machen
- Öffne „Ziele“ und tipp auf „Backup speichern“.
- Speicher die Datei in deiner Cloud oder schick sie dir selbst.
- Mach das am besten jeden Sonntag nach dem Wiegen.
- Zum Wiederherstellen tippst du auf „Backup laden“ und wählst die Datei.

Ohne Backup sind alle Daten weg, wenn du die Browser-Daten löschst.

## 6. Updates einspielen
Lade die geänderten Dateien einfach wieder in dein GitHub-Repository hoch.
Deine Daten auf dem Handy bleiben dabei erhalten.
