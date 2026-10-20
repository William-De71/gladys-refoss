# Refoss

## Overview

This integration brings your Refoss devices into Gladys, on your local network, without the Refoss cloud: the P11S smart plug, the R10, R11 and R21 relays and shutter modules, and the EM01P, EM06, EM06P, EM16 and EM16P energy monitors with their current clamps.

Every outlet, shutter and clamp becomes a Gladys device you can control, put in a room, use in scenes and add to the energy monitoring of Gladys: the integration turns the counters of the devices, which restart every month, into energy indexes that only go up.

Not affiliated with Refoss.

![The “Refoss device” widget for a heat pump clamp next to the “Refoss power” overview (generated illustration, not a screenshot)](https://raw.githubusercontent.com/William-De71/gladys-refoss/main/docs/assets/widgets.en.png)

## Requirements

- Gladys Assistant 5.1.0 or later.
- Your Refoss devices set up in the Refoss app and connected to the same network as Gladys.
- For the first models (R10, EM06, EM16): a fixed IP address, set as a DHCP reservation in your router.
- If you protected your devices with a password in the Refoss app: that password.

## Configuration

### Devices

The current models (P11S, R11, R21, EM01P, EM06P, EM16P) are found by themselves: accept the network discovery when you install the integration, then press **Search the devices**.

The first models (R10, EM06, EM16) cannot be found by Gladys: type their IP addresses in **Addresses of the older models**, separated by commas. You can also type the address of a current model that sits on another subnet.

**Device password**: only if you set one in the Refoss app (the same for all your devices). Leave it empty otherwise.

### Refresh and language

**Measurement refresh**: how often power, voltage, current and energy are sent to Gladys (10, 30 or 60 seconds); on / off and shutters are always sent at once. **Search again**: how often the network is searched for new devices. **Language of the device names**: the language of the feature names and of the scene error messages.

## Usage

### Devices

Open the **Discover** tab of the integration and add the devices you want. There is one Gladys device per channel:

- an **outlet or a relay**: on / off, and power, voltage, current and an energy index when the device measures them;
- a **shutter** (R11 or R21 in cover mode): open, stop, close, and the position once the motor is calibrated in the Refoss app;
- a **current clamp** of an energy monitor: power (below zero when the line sends energy back, a solar line for example), voltage, current, energy consumed and energy returned.

The names come from the Refoss app; a clamp without a name is called after its box and its position (`A1`, `B1`…).

### Energy monitoring

The **Energy consumed** feature of an outlet or a clamp is an index in kWh that only goes up: add the device to the energy monitoring of Gladys to see its daily consumption and its cost. The **Energy returned** feature of a clamp follows what it sent back. The index starts the day you add the device.

### Widgets

- **Refoss power**: every outlet, clamp and shutter at a glance, the hungriest first, with its energy of the month, and the devices that do not answer.
- **Refoss device**: one outlet, clamp or shutter with its live power, today, this month, its power curve of the last 24 hours and its buttons.

### Scenes

Triggers: **A button on a Refoss device is pressed** (single, double, triple or long press on the input of an R11, R21 or P11S), **A Refoss protection trips** (overpower, overvoltage, overcurrent, undervoltage, overheating), **A Refoss device is lost**, **A Refoss device is back**.

Actions: **Turn a Refoss outlet on for a while** (off after the duration, even after a restart), **Read the energy of a Refoss device** (power, today, this week, this month, returned, index).

Examples:

- A double press on the hallway button → turn every light off.
- A protection trips on the oven outlet → send a notification.
- Every evening → read the energy of the heat pump and send it in a message.

## Troubleshooting

- **A device is not found**: check that the Refoss app reaches it on the same Wi-Fi as Gladys and that your network lets mDNS through, or type its address. An R10, EM06 or EM16 always needs its address.
- **"protected by a password"**: type the password of the Refoss app in the configuration.
- **A clamp counts consumption as returned energy**: turn the clamp around (the arrow on it shows the direction).
- **"Gladys refused the network search"**: reinstall the integration and accept its network discovery.
- The **Search the devices** button lists what the integration sees; the Logs tab of the integration tells more.

Report a problem on [GitHub](https://github.com/William-De71/gladys-refoss/issues) with your Gladys version, the integration version, the model of the device and the logs.
