# Gladiator Pilot — 2021 Jeep Gladiator JT (3.0L V6 EcoDiesel) Command Deck

Standalone, zero-VIN-lock Uconnect "Off-Road Pages" diagnostic, telemetry, As-Built Vault, surgical `0x2E` vehicle coding, sPOD-style live actuation, and Y-splitter UDS sniffer application built for the **2021 Jeep Gladiator (JT) 3.0L V6 EcoDiesel** using **Vgate vLinker FD+ (`V-LINK01`)** and **Veepeak BLE**.

**Live Web App (HTTPS PWA):** https://reedzilla.github.io/gladiator-pilot/

---

## Hardware Architecture

| Bus | OBD-II Pins | Bitrate | STN / vLinker Preset | Modules Reached |
| :--- | :--- | :--- | :--- | :--- |
| **`CAN-C`** | Pins **6 & 14** | 500 kbps | `STP 33` (11b) / `STP 34` (29b) | PCM (3.0L EcoDiesel `7E0→7E8`), TCM (8HP75 `7E1→7E9`), ABS/ESC (`747→4C7`), BCM C-side (`620→504` / `18DA40F1`), DTCM (`744→4C4`), EPS (`75A→4DA`), SCCM (`762→4E2`), ORC (`740→4C0`), SGW (`47E→47F`) |
| **`CAN-IHS`** | Pins **3 & 11** *(via 12+8 cable)* | 125 kbps | `STP 53` (11b) / `STP 54` (29b) | IPC Cluster (`742→4C2`), BCM IHS-side (`620→504`), Uconnect Radio (`680→510`), HVAC (`788→789`), RF Hub (`749→4C9`), Door Modules (`791/792`) |

> **Why `vLinker FD+` works on both buses:** The "FD" in `vLinker FD+` stands for *Ford Diagnostics* — its secondary MS-CAN transceiver is wired to **Pins 3 & 11 @ 125 kbps**, the exact physical pin pair and bitrate used by the Jeep JL/JT 12+8 SGW bypass cable for `CAN-IHS`.

---

## Quick Start

### In the Cab (Phone / Tablet / Laptop over HTTPS)
Open https://reedzilla.github.io/gladiator-pilot/ in Chrome or Edge (Android / Windows / macOS) and install to your home screen as a PWA.

### Local Dev Server
```bash
npm install
npm run dev
```
Open `http://localhost:5180` in Chrome or Edge:
- **Bluetooth LE (`Veepeak BLE` / `vLinker BLE`):** Click **Connect Bluetooth LE**.
- **Bluetooth Classic SPP / USB (`vLinker FD+`):** Click **Connect Serial / BT Classic** and select the outgoing SPP COM port.
- **Interactive 3.0D Demo Truck:** Launch **Stock OBD Sim** or **12+8 Unlocked Sim** right from the Garage Launchpad (and switch cable state anytime in the top bezel).

---

## Features & Workflow

1. **Off-Road Gauges (Stock OBD Ready):** Auto-streaming 240° SVG radial arc gauges (RPM, Boost PSI w/ Peak Hold, MPH), Drivetrain Thermal Zone Bars (Coolant, 3.0D Oil, ZF 8HP75 Trans Temp `1E1C`), and the **EcoDiesel Aftertreatment & DPF Flow Pipeline** (EGT 1–4 `0178`, DPF Soot % `1E30`, Differential Backpressure PSI `017A`, Active Regen status `018B`).
2. **Health Scan:** Grouped system cards (*Powertrain*, *Chassis/4x4*, *Body/Cabin*, *Uconnect*, *Gateway*) with batched `CAN-C` + single-excursion `CAN-IHS` (`STP 53`) fault reading and clearing.
3. **Truck Mods (12+8 SGW Bypass):** 1-click visual cards for **Tire Size & Axle Gear Calibration** (with GPS speed error & 8HP75 8th-gear RPM calculator), **LED Conversion & Fog Drop-Out**, **Trail Air-Down TPMS Presets**, and **OEM Aux Switches**. Every write automatically backs up the live stock DID to IndexedDB (`vaultDb`), verifies via `0x22` read-back, and supports **1-Tap Restore All to Stock**.
4. **Trail Box:** Backlit 6-gang overland switch pod for live `0x2F` I/O overrides and `0x31` routines with one-tap ECU release (`0x2F .. 00`).
5. **Backups & Lab:** Direct `0x22` range scanner, byte/bit snapshot diff viewer, JSON Vault export/import, and passive OBD Y-splitter UDS sniffer (`STMA` / `ATMA`).
