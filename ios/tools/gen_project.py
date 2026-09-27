#!/usr/bin/env python3
"""
TenpoOne.xcodeproj を作る（Mac に XcodeGen が無いので、ファイル一覧から project.pbxproj を書き出す）。
ファイルを足したら ios/ で `python3 tools/gen_project.py` を実行し直す。
  target Regi  … iPad「TENPO ONE レジ」  com.tenpoone.regi   （SWIFT 条件 REGI）
  target Handy … iPhone「TENPO ONE」     com.tenpoone.handy  （SWIFT 条件 HANDY：ハンディ＋オーナー）
"""
import hashlib, os, json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJ = os.path.join(ROOT, 'TenpoOne.xcodeproj')

def uid(*parts):
    return hashlib.md5('/'.join(parts).encode()).hexdigest()[:24].upper()

def q(v):
    s = str(v)
    if s and all(c.isalnum() or c in '._/$' for c in s) and not s[0].isdigit() or s in ('YES','NO'):
        return s
    return '"' + s.replace('\\', '\\\\').replace('"', '\\"') + '"'

SHARED_SWIFT = sorted(f for f in os.listdir(os.path.join(ROOT, 'Shared')) if f.endswith('.swift'))
SHARED_RES = ['Shared.xcassets', 'bell.wav']

TARGETS = {
    'Regi': {
        'bundle': 'com.tenpoone.regi', 'display': 'TENPO ONE レジ', 'cond': 'REGI', 'family': '2',
        'orient': {'INFOPLIST_KEY_UISupportedInterfaceOrientations_iPad':
                   'UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight UIInterfaceOrientationPortrait UIInterfaceOrientationPortraitUpsideDown',
                   'INFOPLIST_KEY_UIRequiresFullScreen': 'YES'},
    },
    'Handy': {
        'bundle': 'com.tenpoone.handy', 'display': 'TENPO ONE', 'cond': 'HANDY', 'family': '1',
        'orient': {'INFOPLIST_KEY_UISupportedInterfaceOrientations_iPhone': 'UIInterfaceOrientationPortrait'},
    },
}

objs = {}  # id -> (isa, dict)
def add(id_, isa, **fields):
    objs[id_] = (isa, fields)
    return id_

def ftype(name):
    if name.endswith('.swift'): return 'sourcecode.swift'
    if name.endswith('.xcassets'): return 'folder.assetcatalog'
    if name.endswith('.wav'): return 'audio.wav'
    if name.endswith('.entitlements'): return 'text.plist.entitlements'
    if name.endswith('.plist'): return 'text.plist.xml'
    return 'text'

# ---- file references ----
shared_refs = {}
for f in SHARED_SWIFT + SHARED_RES:
    shared_refs[f] = add(uid('ref', 'Shared', f), 'PBXFileReference', lastKnownFileType=ftype(f), path=f, sourceTree='<group>')
shared_group = add(uid('group', 'Shared'), 'PBXGroup', children=[shared_refs[f] for f in SHARED_SWIFT + SHARED_RES], path='Shared', sourceTree='<group>')

target_groups, target_files, products = {}, {}, {}
for t in TARGETS:
    files = ['Assets.xcassets', 'Info.plist', f'{t}.entitlements']
    refs = {f: add(uid('ref', t, f), 'PBXFileReference', lastKnownFileType=ftype(f), path=f, sourceTree='<group>') for f in files}
    target_files[t] = refs
    target_groups[t] = add(uid('group', t), 'PBXGroup', children=list(refs.values()), path=t, sourceTree='<group>')
    products[t] = add(uid('product', t), 'PBXFileReference', explicitFileType='wrapper.application', includeInIndex='0', path=f'{t}.app', sourceTree='BUILT_PRODUCTS_DIR')

products_group = add(uid('group', 'Products'), 'PBXGroup', children=list(products.values()), name='Products', sourceTree='<group>')
main_group = add(uid('group', 'main'), 'PBXGroup', children=[shared_group] + list(target_groups.values()) + [products_group], sourceTree='<group>')

# ---- build settings ----
common = {
    'ALWAYS_SEARCH_USER_PATHS': 'NO', 'ASSETCATALOG_COMPILER_GENERATE_SWIFT_ASSET_SYMBOL_EXTENSIONS': 'YES',
    'CLANG_ENABLE_MODULES': 'YES', 'CLANG_ENABLE_OBJC_ARC': 'YES', 'COPY_PHASE_STRIP': 'NO',
    'ENABLE_STRICT_OBJC_MSGSEND': 'YES', 'ENABLE_USER_SCRIPT_SANDBOXING': 'YES', 'GCC_C_LANGUAGE_STANDARD': 'gnu17',
    'IPHONEOS_DEPLOYMENT_TARGET': '16.0', 'LOCALIZATION_PREFERS_STRING_CATALOGS': 'YES', 'SDKROOT': 'iphoneos',
    'SWIFT_VERSION': '5.0',
}
debug = dict(common, **{'DEBUG_INFORMATION_FORMAT': 'dwarf', 'ENABLE_TESTABILITY': 'YES', 'GCC_OPTIMIZATION_LEVEL': '0',
                        'ONLY_ACTIVE_ARCH': 'YES', 'SWIFT_ACTIVE_COMPILATION_CONDITIONS': 'DEBUG $(inherited)',
                        'SWIFT_OPTIMIZATION_LEVEL': '-Onone'})
release = dict(common, **{'DEBUG_INFORMATION_FORMAT': 'dwarf-with-dsym', 'ENABLE_NS_ASSERTIONS': 'NO',
                          'SWIFT_COMPILATION_MODE': 'wholemodule', 'VALIDATE_PRODUCT': 'YES'})
proj_cfgs = [add(uid('cfg', 'project', n), 'XCBuildConfiguration', buildSettings=s, name=n) for n, s in (('Debug', debug), ('Release', release))]
proj_cfg_list = add(uid('cfglist', 'project'), 'XCConfigurationList', buildConfigurations=proj_cfgs, defaultConfigurationIsVisible='0', defaultConfigurationName='Release')

native_targets = []
for t, info in TARGETS.items():
    s = {
        'ASSETCATALOG_COMPILER_APPICON_NAME': 'AppIcon', 'CODE_SIGN_ENTITLEMENTS': f'{t}/{t}.entitlements',
        'CODE_SIGN_STYLE': 'Automatic', 'CURRENT_PROJECT_VERSION': '1', 'DEVELOPMENT_TEAM': '',
        'ENABLE_PREVIEWS': 'NO', 'GENERATE_INFOPLIST_FILE': 'YES', 'INFOPLIST_FILE': f'{t}/Info.plist',
        'INFOPLIST_KEY_CFBundleDisplayName': info['display'],
        'INFOPLIST_KEY_LSApplicationCategoryType': 'public.app-category.business',
        'INFOPLIST_KEY_UIApplicationSceneManifest_Generation': 'YES',
        'INFOPLIST_KEY_UIApplicationSupportsIndirectInputEvents': 'YES',
        'INFOPLIST_KEY_UILaunchScreen_Generation': 'YES',
        'LD_RUNPATH_SEARCH_PATHS': '$(inherited) @executable_path/Frameworks', 'MARKETING_VERSION': '1.0',
        'PRODUCT_BUNDLE_IDENTIFIER': info['bundle'], 'PRODUCT_NAME': '$(TARGET_NAME)',
        'SUPPORTED_PLATFORMS': 'iphoneos iphonesimulator', 'SUPPORTS_MACCATALYST': 'NO',
        'SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD': 'NO', 'SUPPORTS_XR_DESIGNED_FOR_IPHONE_IPAD': 'NO',
        'SWIFT_ACTIVE_COMPILATION_CONDITIONS': f'$(inherited) {info["cond"]}', 'SWIFT_EMIT_LOC_STRINGS': 'YES',
        'TARGETED_DEVICE_FAMILY': info['family'],
    }
    s.update(info['orient'])
    cfgs = [add(uid('cfg', t, n), 'XCBuildConfiguration', buildSettings=dict(s), name=n) for n in ('Debug', 'Release')]
    cfg_list = add(uid('cfglist', t), 'XCConfigurationList', buildConfigurations=cfgs, defaultConfigurationIsVisible='0', defaultConfigurationName='Release')

    src_files = [add(uid('bf', t, 'src', f), 'PBXBuildFile', fileRef=shared_refs[f]) for f in SHARED_SWIFT]
    res_files = [add(uid('bf', t, 'res', f), 'PBXBuildFile', fileRef=shared_refs[f]) for f in SHARED_RES]
    res_files.append(add(uid('bf', t, 'res', 'Assets.xcassets'), 'PBXBuildFile', fileRef=target_files[t]['Assets.xcassets']))
    src_phase = add(uid('phase', t, 'src'), 'PBXSourcesBuildPhase', buildActionMask='2147483647', files=src_files, runOnlyForDeploymentPostprocessing='0')
    res_phase = add(uid('phase', t, 'res'), 'PBXResourcesBuildPhase', buildActionMask='2147483647', files=res_files, runOnlyForDeploymentPostprocessing='0')
    fw_phase = add(uid('phase', t, 'fw'), 'PBXFrameworksBuildPhase', buildActionMask='2147483647', files=[], runOnlyForDeploymentPostprocessing='0')
    native_targets.append(add(uid('target', t), 'PBXNativeTarget', buildConfigurationList=cfg_list,
                              buildPhases=[src_phase, fw_phase, res_phase], buildRules=[], dependencies=[],
                              name=t, productName=t, productReference=products[t],
                              productType='com.apple.product-type.application'))

project = add(uid('project'), 'PBXProject',
              attributes={'BuildIndependentTargetsInParallel': '1', 'LastSwiftUpdateCheck': '1600', 'LastUpgradeCheck': '1600',
                          'TargetAttributes': {tid: {'CreatedOnToolsVersion': '16.0'} for tid in native_targets}},
              buildConfigurationList=proj_cfg_list, compatibilityVersion='Xcode 14.0', developmentRegion='ja',
              hasScannedForEncodings='0', knownRegions=['ja', 'en', 'Base'], mainGroup=main_group,
              productRefGroup=products_group, projectDirPath='', projectRoot='', targets=native_targets)

# ---- write pbxproj ----
def fmt(v, indent):
    pad = '\t' * indent
    if isinstance(v, dict):
        inner = ''.join(f'{pad}\t{q(k)} = {fmt(v[k], indent + 1)};\n' for k in sorted(v))
        return '{\n' + inner + pad + '}'
    if isinstance(v, list):
        inner = ''.join(f'{pad}\t{fmt(x, indent + 1)},\n' for x in v)
        return '(\n' + inner + pad + ')'
    return q(v)

by_isa = {}
for id_, (isa, fields) in objs.items():
    by_isa.setdefault(isa, []).append((id_, fields))
out = ['// !$*UTF8*$!', '{', '\tarchiveVersion = 1;', '\tclasses = {', '\t};', '\tobjectVersion = 60;', '\tobjects = {', '']
for isa in sorted(by_isa):
    out.append(f'/* Begin {isa} section */')
    for id_, fields in sorted(by_isa[isa]):
        body = dict(fields, isa=isa)
        items = ''.join(f'\t\t\t{q(k)} = {fmt(body[k], 3)};\n' for k in ['isa'] + sorted(k for k in body if k != 'isa'))
        out.append(f'\t\t{id_} = {{\n{items}\t\t}};')
    out.append(f'/* End {isa} section */\n')
out += ['\t};', f'\trootObject = {project};', '}', '']
os.makedirs(PROJ, exist_ok=True)
open(os.path.join(PROJ, 'project.pbxproj'), 'w', encoding='utf-8').write('\n'.join(out))

ws = os.path.join(PROJ, 'project.xcworkspace')
os.makedirs(ws, exist_ok=True)
open(os.path.join(ws, 'contents.xcworkspacedata'), 'w').write(
    '<?xml version="1.0" encoding="UTF-8"?>\n<Workspace\n   version = "1.0">\n   <FileRef\n      location = "self:">\n   </FileRef>\n</Workspace>\n')

schemes = os.path.join(PROJ, 'xcshareddata', 'xcschemes')
os.makedirs(schemes, exist_ok=True)
for t, tid in zip(TARGETS, native_targets):
    ref = (f'<BuildableReference BuildableIdentifier = "primary" BlueprintIdentifier = "{tid}" '
           f'BuildableName = "{t}.app" BlueprintName = "{t}" ReferencedContainer = "container:TenpoOne.xcodeproj"></BuildableReference>')
    open(os.path.join(schemes, f'{t}.xcscheme'), 'w').write(f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion = "1600" version = "1.7">
   <BuildAction parallelizeBuildables = "YES" buildImplicitDependencies = "YES">
      <BuildActionEntries>
         <BuildActionEntry buildForTesting = "YES" buildForRunning = "YES" buildForProfiling = "YES" buildForArchiving = "YES" buildForAnalyzing = "YES">
            {ref}
         </BuildActionEntry>
      </BuildActionEntries>
   </BuildAction>
   <TestAction buildConfiguration = "Debug" selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv = "YES">
   </TestAction>
   <LaunchAction buildConfiguration = "Debug" selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB" launchStyle = "0" useCustomWorkingDirectory = "NO" ignoresPersistentStateOnLaunch = "NO" debugDocumentVersioning = "YES" debugServiceExtension = "internal" allowLocationSimulation = "YES">
      <BuildableProductRunnable runnableDebuggingMode = "0">
         {ref}
      </BuildableProductRunnable>
   </LaunchAction>
   <ProfileAction buildConfiguration = "Release" shouldUseLaunchSchemeArgsEnv = "YES" savedToolIdentifier = "" useCustomWorkingDirectory = "NO" debugDocumentVersioning = "YES">
      <BuildableProductRunnable runnableDebuggingMode = "0">
         {ref}
      </BuildableProductRunnable>
   </ProfileAction>
   <AnalyzeAction buildConfiguration = "Debug">
   </AnalyzeAction>
   <ArchiveAction buildConfiguration = "Release" revealArchiveInOrganizer = "YES">
   </ArchiveAction>
</Scheme>
''')
print('wrote', PROJ, len(objs), 'objects')
