/**
 * Converts foliate's readable page within one spine section into the single
 * global page number used everywhere in Reader UI.
 *
 * `sectionPage` is already one-based. Non-linear sections contribute zero to
 * `sectionPages`, matching the visible reader's next/previous navigation.
 */
export function getGlobalReaderPage(
  sectionPages: readonly number[],
  spineIndex: number,
  sectionPage: number,
) {
  let pageNumber = sectionPage;
  const sectionLimit = Math.max(0, Math.min(spineIndex, sectionPages.length));
  for (let index = 0; index < sectionLimit; index += 1) pageNumber += sectionPages[index] ?? 0;
  return pageNumber;
}
