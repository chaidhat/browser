const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

exports.default = async function afterPack(context) {
  if (process.platform !== 'darwin') return;

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );
  const resourcesPath = path.join(appPath, 'Contents', 'Resources');
  const xcassets = path.join(__dirname, '..', 'icon', 'Assets.xcassets');

  if (!fs.existsSync(xcassets)) {
    console.log('No Assets.xcassets found, skipping dark mode icon');
    return;
  }

  console.log('Compiling Asset Catalog for dark mode icon...');

  try {
    execSync(
      `xcrun actool --compile "${resourcesPath}" --platform macosx --minimum-deployment-target 15.0 --app-icon AppIcon --output-partial-info-plist /dev/null "${xcassets}"`,
      { stdio: 'inherit' }
    );

    // Remove the old icon.icns to avoid conflicts
    const oldIcon = path.join(resourcesPath, 'icon.icns');
    if (fs.existsSync(oldIcon)) fs.unlinkSync(oldIcon);

    // Update Info.plist to use the Asset Catalog icon
    const plistPath = path.join(appPath, 'Contents', 'Info.plist');
    let plist = fs.readFileSync(plistPath, 'utf8');
    // Replace CFBundleIconFile value with AppIcon (Asset Catalog name)
    plist = plist.replace(
      /<key>CFBundleIconFile<\/key>\s*<string>[^<]*<\/string>/,
      '<key>CFBundleIconFile</key>\n\t<string>AppIcon</string>'
    );
    // Add CFBundleIconName for Asset Catalog lookup
    if (!plist.includes('CFBundleIconName')) {
      plist = plist.replace(
        '<key>CFBundleIconFile</key>',
        '<key>CFBundleIconName</key>\n\t<string>AppIcon</string>\n\t<key>CFBundleIconFile</key>'
      );
    }
    fs.writeFileSync(plistPath, plist);

    console.log('Dark mode icon compiled and injected successfully');
  } catch (err) {
    console.error('Failed to compile Asset Catalog:', err.message);
  }
};
