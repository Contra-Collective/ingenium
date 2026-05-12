// Template materialization. Pure node: APIs, no deps.

import { mkdir, writeFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { defaultTemplate } from './templates/default.ts'
import { minimalTemplate } from './templates/minimal.ts'
import { bunTemplate } from './templates/bun.ts'

export type TemplateName = 'default' | 'minimal' | 'bun'

export interface ScaffoldOptions {
  force?: boolean
  projectName: string
}

type FileMap = Record<string, string>

const TEMPLATES: Record<TemplateName, FileMap> = {
  default: defaultTemplate,
  minimal: minimalTemplate,
  bun: bunTemplate,
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

function substitute(contents: string, projectName: string): string {
  return contents.replace(/\$\{NAME\}/g, projectName)
}

export async function scaffold(
  target: string,
  template: TemplateName,
  options: ScaffoldOptions,
): Promise<void> {
  const files = TEMPLATES[template]
  if (files === undefined) {
    throw new Error(`unknown template "${template}"`)
  }

  const exists = await pathExists(target)
  if (exists && options.force !== true) {
    throw new Error(`directory already exists: ${target} (pass --force to overwrite)`)
  }

  await mkdir(target, { recursive: true })

  for (const [relPath, contents] of Object.entries(files)) {
    const abs = join(target, relPath)
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, substitute(contents, options.projectName), 'utf8')
  }
}
