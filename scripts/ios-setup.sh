#!/bin/sh
# Prepara o projeto do iPad. Rode num Mac com Xcode e CocoaPods:  npm run ios:setup
set -e
cd "$(dirname "$0")/.."

[ -d ios ] || npx cap add ios
npx cap sync ios

PLIST=ios/App/App/Info.plist
PB=/usr/libexec/PlistBuddy
set_key() { # chave tipo valor
  "$PB" -c "Set :$1 $3" "$PLIST" 2>/dev/null || "$PB" -c "Add :$1 $2 $3" "$PLIST"
}
set_key UIFileSharingEnabled bool true                   # a pasta do app aparece em Arquivos › No iPad › Memo
set_key LSSupportsOpeningDocumentsInPlace bool true
set_key UIStatusBarHidden bool true                      # sem barra de status
set_key UIViewControllerBasedStatusBarAppearance bool false
set_key UIRequiresFullScreen bool true                   # sem multitarefa (Split View / Slide Over)

echo "Pronto. Abra o projeto com:  npm run ios:open"
