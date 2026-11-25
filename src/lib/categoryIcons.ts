import groups from "./lucide-groups.json";

export interface CategoryIconGroup {
  label: string;
  icons: string[];
}

/** 精选图标分组：由 src/lib/lucide-groups.json 维护，顺序即弹窗里的展示顺序 */
export const CATEGORY_ICON_GROUPS: CategoryIconGroup[] = groups as CategoryIconGroup[];

const CURATED = new Set(CATEGORY_ICON_GROUPS.flatMap((group) => group.icons));

/** 精选图标：合成一个 sprite，每页都用，一次请求约 85 KB */
export const CURATED_SPRITE = "/category-icons.svg";
/** 精选之外的图标：一个图标一个文件（约 350 B），用到哪个才请求哪个 */
export const SINGLE_ICON_DIR = "/icons";

/** 图标名只接受小写字母、数字、短横线，避免拼出奇怪的 URL / 注入 */
export function isIconName(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(value);
}

/** 精选走合集 sprite，其余走单图标文件——不再整包下载全量 sprite */
export function iconHref(name: string): string {
  return CURATED.has(name)
    ? CURATED_SPRITE + "#icon-" + name
    : SINGLE_ICON_DIR + "/" + name + ".svg#icon-" + name;
}

export function categoryIcon(name: string, size = 15): string {
  const key = isIconName(name) ? name : "folder";
  return (
    '<svg class="cat-icon" viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<use href="' + iconHref(key) + '"></use>' +
    "</svg>"
  );
}
