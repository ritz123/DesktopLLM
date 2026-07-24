export function needsWorkspaceSetup(workFolder?: string, codingWorkFolder?: string) {
  return !workFolder && !codingWorkFolder;
}
