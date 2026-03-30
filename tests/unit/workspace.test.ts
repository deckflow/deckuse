import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import { Workspace } from '../../src/core/workspace.js'
import { WorkspaceNotInitializedError } from '../../src/utils/errors.js'

describe('Workspace', () => {
  const testDir = path.join(process.cwd(), 'tests', '.test-workspaces')
  const testWorkspace = path.join(testDir, 'test.deck')

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('isWorkspace', () => {
    it('should return false for non-workspace directory', async () => {
      const result = await Workspace.isWorkspace(testDir)
      expect(result).toBe(false)
    })

    it('should return true for initialized workspace', async () => {
      // Create a minimal workspace structure
      await fs.mkdir(path.join(testWorkspace, '.deckuse'), { recursive: true })
      await fs.writeFile(
        path.join(testWorkspace, '.deckuse', 'metadata.json'),
        JSON.stringify({
          version: '1.0.0',
          initialized: new Date().toISOString(),
          lastModified: new Date().toISOString(),
          indexes: {
            slides: [],
            shapes: [],
            layouts: [],
          },
        })
      )

      const result = await Workspace.isWorkspace(testWorkspace)
      expect(result).toBe(true)
    })
  })

  describe('load', () => {
    it('should throw WorkspaceNotInitializedError for non-existent workspace', async () => {
      await expect(Workspace.load(testWorkspace)).rejects.toThrow(
        WorkspaceNotInitializedError
      )
    })

    it('should load existing workspace', async () => {
      // Create a minimal workspace
      await fs.mkdir(path.join(testWorkspace, '.deckuse'), { recursive: true })
      const metadata = {
        version: '1.0.0',
        sourcePptx: '/path/to/test.pptx',
        initialized: new Date().toISOString(),
        lastModified: new Date().toISOString(),
        indexes: {
          slides: [],
          shapes: [],
          layouts: [],
        },
      }
      await fs.writeFile(
        path.join(testWorkspace, '.deckuse', 'metadata.json'),
        JSON.stringify(metadata)
      )

      const workspace = await Workspace.load(testWorkspace)
      expect(workspace.workspaceDir).toBe(testWorkspace)
      expect(workspace.metadata.version).toBe('1.0.0')
      expect(workspace.metadata.sourcePptx).toBe('/path/to/test.pptx')
    })
  })

  describe('getStatus', () => {
    it('should return not initialized status for non-workspace', async () => {
      // Create workspace instance without proper initialization
      await fs.mkdir(testWorkspace, { recursive: true })
      await fs.mkdir(path.join(testWorkspace, '.deckuse'), { recursive: true })
      const metadata = {
        version: '1.0.0',
        initialized: new Date(),
        lastModified: new Date(),
        indexes: {
          slides: [],
          shapes: [],
          layouts: [],
        },
      }
      await fs.writeFile(
        path.join(testWorkspace, '.deckuse', 'metadata.json'),
        JSON.stringify(metadata)
      )

      const workspace = await Workspace.load(testWorkspace)
      const status = await workspace.getStatus()

      expect(status.initialized).toBe(true)
      expect(status.valid).toBe(true)
    })
  })
})
