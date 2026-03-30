/**
 * Workspace management for DeckUse
 * Manages .deck/ directory structure and metadata
 */

import { promises as fs } from 'fs'
import path from 'path'
import {
  WorkspaceMetadata,
  WorkspaceStatus,
  ValidationResult,
  SlideIndex,
  ShapeIndex,
  LayoutIndex,
} from './types.js'
import {
  WorkspaceNotInitializedError,
  FileNotFoundError,
} from '../utils/errors.js'

const METADATA_FILENAME = 'metadata.json'
const DECKUSE_DIR = '.deckuse'
const WORKSPACE_VERSION = '1.0.0'

export class Workspace {
  private constructor(
    public readonly workspaceDir: string,
    public metadata: WorkspaceMetadata
  ) {}

  /**
   * Initialize a new workspace from a PPTX file
   */
  static async init(
    pptxPath: string,
    outputDir?: string
  ): Promise<Workspace> {
    // Verify PPTX file exists
    try {
      await fs.access(pptxPath)
    } catch {
      throw new FileNotFoundError(pptxPath)
    }

    // Determine workspace directory
    const workspaceDir =
      outputDir || pptxPath.replace(/\.pptx$/i, '.deck')

    // Create workspace directory structure
    await fs.mkdir(workspaceDir, { recursive: true })
    const deckuseDir = path.join(workspaceDir, DECKUSE_DIR)
    await fs.mkdir(deckuseDir, { recursive: true })

    // Create initial metadata
    const metadata: WorkspaceMetadata = {
      version: WORKSPACE_VERSION,
      sourcePptx: path.resolve(pptxPath),
      initialized: new Date(),
      lastModified: new Date(),
      indexes: {
        slides: [],
        shapes: [],
        layouts: [],
      },
    }

    // Save metadata
    await Workspace.saveMetadata(workspaceDir, metadata)

    return new Workspace(workspaceDir, metadata)
  }

  /**
   * Load an existing workspace
   */
  static async load(workspaceDir: string): Promise<Workspace> {
    const metadata = await Workspace.loadMetadata(workspaceDir)
    return new Workspace(workspaceDir, metadata)
  }

  /**
   * Check if a directory is an initialized workspace
   */
  static async isWorkspace(dir: string): Promise<boolean> {
    try {
      const metadataPath = path.join(dir, DECKUSE_DIR, METADATA_FILENAME)
      await fs.access(metadataPath)
      return true
    } catch {
      return false
    }
  }

  /**
   * Get workspace status
   */
  async getStatus(): Promise<WorkspaceStatus> {
    const isInitialized = await Workspace.isWorkspace(this.workspaceDir)

    if (!isInitialized) {
      return {
        initialized: false,
        valid: false,
        hasChanges: false,
      }
    }

    // Check if workspace has changes (simplified - just check if files exist)
    const hasContent = await this.hasContent()

    return {
      initialized: true,
      sourceFile: this.metadata.sourcePptx,
      valid: isInitialized,
      hasChanges: hasContent,
      lastValidated: new Date(),
    }
  }

  /**
   * Validate workspace structure
   */
  async validate(): Promise<ValidationResult> {
    const errors: ValidationResult['errors'] = []
    const warnings: ValidationResult['warnings'] = []

    // Check .deckuse directory exists
    const deckuseDir = path.join(this.workspaceDir, DECKUSE_DIR)
    try {
      await fs.access(deckuseDir)
    } catch {
      errors.push({
        code: 'MISSING_DECKUSE_DIR',
        message: '.deckuse directory not found',
        path: deckuseDir,
      })
    }

    // Check metadata file exists
    try {
      await Workspace.loadMetadata(this.workspaceDir)
    } catch {
      errors.push({
        code: 'MISSING_METADATA',
        message: 'metadata.json not found or invalid',
        path: path.join(deckuseDir, METADATA_FILENAME),
      })
    }

    // Check for [Content_Types].xml (basic PPTX structure)
    const contentTypesPath = path.join(this.workspaceDir, '[Content_Types].xml')
    try {
      await fs.access(contentTypesPath)
    } catch {
      warnings.push({
        code: 'MISSING_CONTENT_TYPES',
        message: '[Content_Types].xml not found',
        path: contentTypesPath,
      })
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    }
  }

  /**
   * Update workspace metadata
   */
  async updateMetadata(
    updates: Partial<Omit<WorkspaceMetadata, 'version' | 'initialized'>>
  ): Promise<void> {
    this.metadata = {
      ...this.metadata,
      ...updates,
      lastModified: new Date(),
    }
    await Workspace.saveMetadata(this.workspaceDir, this.metadata)
  }

  /**
   * Update slide index
   */
  async updateSlideIndex(slides: SlideIndex[]): Promise<void> {
    await this.updateMetadata({
      indexes: {
        ...this.metadata.indexes,
        slides,
      },
    })
  }

  /**
   * Update shape index
   */
  async updateShapeIndex(shapes: ShapeIndex[]): Promise<void> {
    await this.updateMetadata({
      indexes: {
        ...this.metadata.indexes,
        shapes,
      },
    })
  }

  /**
   * Update layout index
   */
  async updateLayoutIndex(layouts: LayoutIndex[]): Promise<void> {
    await this.updateMetadata({
      indexes: {
        ...this.metadata.indexes,
        layouts,
      },
    })
  }

  /**
   * Get path to .deckuse directory
   */
  get deckuseDir(): string {
    return path.join(this.workspaceDir, DECKUSE_DIR)
  }

  /**
   * Check if workspace has content (PPTX files extracted)
   */
  private async hasContent(): Promise<boolean> {
    try {
      const pptDir = path.join(this.workspaceDir, 'ppt')
      await fs.access(pptDir)
      return true
    } catch {
      return false
    }
  }

  /**
   * Load metadata from workspace
   */
  private static async loadMetadata(
    workspaceDir: string
  ): Promise<WorkspaceMetadata> {
    const metadataPath = path.join(workspaceDir, DECKUSE_DIR, METADATA_FILENAME)

    try {
      const content = await fs.readFile(metadataPath, 'utf-8')
      const metadata = JSON.parse(content)

      // Convert date strings back to Date objects
      metadata.initialized = new Date(metadata.initialized)
      metadata.lastModified = new Date(metadata.lastModified)

      return metadata
    } catch (error) {
      throw new WorkspaceNotInitializedError(workspaceDir)
    }
  }

  /**
   * Save metadata to workspace
   */
  private static async saveMetadata(
    workspaceDir: string,
    metadata: WorkspaceMetadata
  ): Promise<void> {
    const metadataPath = path.join(workspaceDir, DECKUSE_DIR, METADATA_FILENAME)
    const content = JSON.stringify(metadata, null, 2)
    await fs.writeFile(metadataPath, content, 'utf-8')
  }
}
