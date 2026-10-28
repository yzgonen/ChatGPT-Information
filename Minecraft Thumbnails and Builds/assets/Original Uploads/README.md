# Original Minecraft asset uploads

This folder preserves **all 20 ZIP archives you uploaded**, including the vanilla Minecraft asset archive, resource packs, model packs, sound packs, and rendering libraries. The two ItemBoundReBound ZIPs are byte-for-byte identical; both original names are retained.

Some archives exceed the GitHub connector's per-upload request size, so they are stored as consecutive raw binary parts named `.part001`, `.part002`, and so on. These parts are not standalone ZIPs. Download every part for an archive, place them with `reassemble.py`, then run:

```bash
python reassemble.py
```

The script rebuilds each split archive and checks its ZIP CRC. Archives stored as a single ZIP file can be used directly. The GitHub folder page lists all downloadable files.

## Inventory

| Original uploaded filename | Stored form |
| --- | --- |
| `BeagleNF404's UI - v1.4(1).zip` | 4 parts |
| `Blades Of Majestica(1).zip` | ZIP file |
| `CustomWeapons-Models(1).zip` | 3 parts |
| `Enhanced Audio Ambience r2(1).zip` | 2 parts |
| `Enhanced Audio r7(1).zip` | 3 parts |
| `Enhanced Hit Sounds V1(1).zip` | ZIP file |
| `Extra_Items_Pack_v1.0.3-1.21.11+(1).zip` | ZIP file |
| `Fabulous Enchanted 3D(1).zip` | ZIP file |
| `ItemBoundReBound(1).zip` | ZIP file |
| `ItemBoundReBound(2).zip` | ZIP file |
| `Visual Effects+.zip` | 3 parts |
| `[1.21.11] Minimal HUD Icons v1.2(1).zip` | ZIP file |
| `mc-assets-main(3).zip` | ZIP file |
| `mc-blockbench-models-master(2).zip` | ZIP file |
| `minecraft-assets-master(2).zip` | 11 parts |
| `old-sounds-1.21.11(1).zip` | ZIP file |
| `skinview3d-master(2).zip` | 2 parts |
| `three.js-master.zip` | 39 parts |
| `§eStrings & Things 26.3(1).zip` | ZIP file |
| `§lOmnis'§l §d§lEnchantments§l§d(1).zip` | ZIP file |

Files are kept as supplied. Check each archive's included license and attribution requirements before redistributing its contents.
