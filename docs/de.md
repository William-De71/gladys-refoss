# Refoss

## Überblick

Diese Integration bringt Ihre Refoss-Geräte in Gladys, im lokalen Netzwerk, ohne die Refoss-Cloud: die Steckdose P11S, die Relais und Rollladenmodule R10, R11 und R21 sowie die Energiemessgeräte EM01P, EM06, EM06P, EM16 und EM16P mit ihren Stromzangen.

Jede Steckdose, jeder Rollladen und jede Zange wird zu einem Gladys-Gerät, das Sie steuern, einem Raum zuordnen, in Szenen verwenden und in die Energieüberwachung von Gladys aufnehmen können: Die Integration macht aus den Zählern der Geräte, die jeden Monat bei null beginnen, Energiezählerstände, die nur steigen.

Keine Verbindung zu Refoss.

![Das Widget „Refoss-Gerät“ für die Zange einer Wärmepumpe neben der Übersicht „Refoss-Leistung“ (generierte Illustration, kein Screenshot)](https://raw.githubusercontent.com/William-De71/gladys-refoss/main/docs/assets/widgets.de.png)

## Voraussetzungen

- Gladys Assistant 5.3.0 oder neuer.
- Ihre Refoss-Geräte, eingerichtet in der Refoss-App und mit demselben Netzwerk wie Gladys verbunden.
- Für die ersten Modelle (R10, EM06, EM16): eine feste IP-Adresse, eingerichtet als DHCP-Reservierung in Ihrem Router.
- Falls Sie Ihre Geräte in der Refoss-App mit einem Passwort geschützt haben: dieses Passwort.

## Konfiguration

### Geräte

Die aktuellen Modelle (P11S, R11, R21, EM01P, EM06P, EM16P) werden automatisch gefunden: Akzeptieren Sie bei der Installation der Integration die Netzwerkerkennung und klicken Sie dann auf **Geräte suchen**.

Die ersten Modelle (R10, EM06, EM16) kann Gladys nicht selbst finden: Geben Sie ihre IP-Adressen durch Kommas getrennt unter **Adressen der älteren Modelle** ein. Dort können Sie auch die Adresse eines aktuellen Modells eingeben, das sich in einem anderen Subnetz befindet.

**Gerätepasswort**: nur, wenn Sie in der Refoss-App eines gesetzt haben (für alle Ihre Geräte gleich). Andernfalls leer lassen.

### Aktualisierung und Sprache

**Aktualisierung der Messwerte**: wie oft Leistung, Spannung, Strom und Energie an Gladys gesendet werden (10, 30 oder 60 Sekunden); Ein / Aus und Rollläden werden immer sofort gesendet. **Erneut suchen**: wie oft das Netzwerk nach neuen Geräten durchsucht wird. **Sprache der Gerätenamen**: die Sprache der Funktionsnamen und der Fehlermeldungen in Szenen.

## Verwendung

### Geräte

Öffnen Sie den **Tab Erkennung** der Integration und fügen Sie die gewünschten Geräte hinzu. Es gibt ein Gladys-Gerät pro Kanal:

- eine **Steckdose oder ein Relais**: Ein / Aus sowie Leistung, Spannung, Strom und ein Energiezählerstand, wenn das Gerät sie misst;
- ein **Rollladen** (R11 oder R21 im Rollladenmodus): Öffnen, Stopp, Schließen und die Position, sobald der Motor in der Refoss-App kalibriert ist;
- eine **Stromzange** eines Energiemessgeräts: Leistung (unter null, wenn die Leitung Energie zurückspeist, etwa eine Solarleitung), Spannung, Strom, verbrauchte und zurückgespeiste Energie.

Die Namen stammen aus der Refoss-App; eine Zange ohne Namen wird nach ihrer Box und ihrer Position benannt (`A1`, `B1`…).

### Energieüberwachung

Die Funktion **Verbrauchte Energie** einer Steckdose oder Zange ist ein Zählerstand in kWh, der nur steigt: Nehmen Sie das Gerät in die Energieüberwachung von Gladys auf, um seinen täglichen Verbrauch und dessen Kosten zu sehen. Die Funktion **Zurückgespeiste Energie** einer Zange erfasst, was sie zurückgespeist hat. Der Zählerstand beginnt an dem Tag, an dem Sie das Gerät hinzufügen.

### Widgets

- **Refoss-Leistung**: alle Steckdosen, Zangen und Rollläden auf einen Blick, die größten Verbraucher zuerst, jeweils mit der Energie des Monats, dazu die Geräte, die nicht antworten.
- **Refoss-Gerät**: eine Steckdose, Zange oder ein Rollladen mit aktueller Leistung, heute, diesem Monat, der Leistungskurve der letzten 24 Stunden und den Schaltflächen.

### Szenen

Auslöser: **Ein Taster an einem Refoss-Gerät wird gedrückt** (einfacher, doppelter, dreifacher oder langer Druck am Eingang eines R11, R21 oder P11S), **Ein Refoss-Schutz löst aus** (Überlast, Überspannung, Überstrom, Unterspannung, Überhitzung), **Ein Refoss-Gerät ist weg**, **Ein Refoss-Gerät ist zurück**.

Aktionen: **Refoss-Steckdose eine Zeit lang einschalten** (nach Ablauf der Dauer aus, auch nach einem Neustart), **Energie eines Refoss-Geräts lesen** (Leistung, heute, diese Woche, dieser Monat, zurückgespeist, Zählerstand).

Beispiele:

- Doppelter Druck auf den Taster im Flur → alle Lichter ausschalten.
- Ein Schutz löst an der Steckdose des Backofens aus → eine Benachrichtigung senden.
- Jeden Abend → die Energie der Wärmepumpe lesen und in einer Nachricht senden.

## Fehlerbehebung

- **Ein Gerät wird nicht gefunden**: Prüfen Sie, ob die Refoss-App es im selben WLAN wie Gladys erreicht und ob Ihr Netzwerk mDNS durchlässt, oder geben Sie seine Adresse ein. Ein R10, EM06 oder EM16 braucht immer seine Adresse.
- **„durch ein Passwort geschützt“**: Geben Sie das Passwort der Refoss-App in der Konfiguration ein.
- **Eine Zange zählt Verbrauch als zurückgespeiste Energie**: Drehen Sie die Zange um (der Pfeil darauf zeigt die Richtung).
- **„Gladys hat die Netzwerksuche abgelehnt“**: Installieren Sie die Integration neu und akzeptieren Sie ihre Netzwerkerkennung.
- Die Schaltfläche **Geräte suchen** listet auf, was die Integration sieht; der Tab Logs der Integration verrät mehr.

Melden Sie ein Problem auf [GitHub](https://github.com/William-De71/gladys-refoss/issues) mit Ihrer Gladys-Version, der Version der Integration, dem Gerätemodell und den Logs.
