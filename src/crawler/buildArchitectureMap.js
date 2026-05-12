const { crawlRepository } = require('./repoCrawler')

async function buildArchitectureMap() {
  const repository = await crawlRepository('../')

  const architecture = {
    backend: [],
    frontend: [],
    database: [],
    auth: [],
    config: [],
  }

  for (const file of repository) {
    const filename = file.file.toLowerCase()

    // BACKEND
    if (
      filename.includes('api') ||
      filename.includes('controller') ||
      filename.includes('service')
    ) {
      architecture.backend.push(file.file)
    }

    // FRONTEND
    if (
      filename.includes('page') ||
      filename.includes('component') ||
      filename.endsWith('.tsx')
    ) {
      architecture.frontend.push(file.file)
    }

    // DATABASE
    if (
      filename.includes('prisma') ||
      filename.includes('schema')
    ) {
      architecture.database.push(file.file)
    }

    // AUTH
    if (
      filename.includes('auth') ||
      filename.includes('jwt') ||
      filename.includes('session')
    ) {
      architecture.auth.push(file.file)
    }

    // CONFIG
    if (
      filename.includes('config') ||
      filename.includes('.env') ||
      filename.includes('package.json')
    ) {
      architecture.config.push(file.file)
    }
  }

  console.log('\n=== ARCHITECTURE MAP ===')

  console.log('\nBACKEND:')
  console.log(architecture.backend.slice(0, 20))

  console.log('\nFRONTEND:')
  console.log(architecture.frontend.slice(0, 20))

  console.log('\nDATABASE:')
  console.log(architecture.database.slice(0, 20))

  console.log('\nAUTH:')
  console.log(architecture.auth.slice(0, 20))

  console.log('\nCONFIG:')
  console.log(architecture.config.slice(0, 20))
}

buildArchitectureMap()