"""Insert classes.dex into the aapt2-produced base APK without disturbing its
resource table. Called by build-apk.js (kept separate so the build stays
readable and needs no npm packages)."""
import os
import sys
import zipfile

base, dex, out = sys.argv[1:4]

with zipfile.ZipFile(base, "r") as zin, zipfile.ZipFile(out, "w") as zout:
    for item in zin.infolist():
        zout.writestr(item, zin.read(item.filename))
    info = zipfile.ZipInfo("classes.dex", date_time=(2020, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o644 << 16
    with open(dex, "rb") as f:
        zout.writestr(info, f.read())

print("merged dex -> %s (%d bytes)" % (out, os.path.getsize(out)))
