import fs from 'node:fs'
import path from 'node:path'

import { renderAppUpdateYml } from './mac-packaging.mjs'

export async function afterPack(context) {
  const feed = String(process.env.VIBENOTE_RESOLVED_UPDATE_FEED || '').trim()
  const productName = context.packager.appInfo.productFilename
  const target = path.join(context.appOutDir, `${productName}.app`, 'Contents', 'Resources', 'app-update.yml')
  if (!feed) {
    fs.rmSync(target, { force: true })
    return
  }
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, renderAppUpdateYml(feed))
}
