declare const assetPathBrand: unique symbol;

/** Absolute, symlink-resolved path already validated to lie inside the workspace. */
export type AssetPath = string & { readonly [assetPathBrand]: true };

/** Only for the code that performs the validation (libs/tools) and for tests. */
export function asAssetPath(validated: string): AssetPath {
  return validated as AssetPath;
}
