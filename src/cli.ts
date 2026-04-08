/**
 * DeckUse CLI entry point
 */

import { Command } from 'commander'
import { initCommand } from './commands/init.js'
import { statusCommand } from './commands/status.js'
import { commitCommand } from './commands/commit.js'
import { listSlidesCommand } from './commands/list-slides.js'
import { showSlideCommand } from './commands/show-slide.js'
import { getTextCommand } from './commands/get-text.js'
import { setTextCommand } from './commands/set-text.js'
import { replaceTextCommand } from './commands/replace-text.js'
import { setFontSizeCommand } from './commands/set-font-size.js'
import { logger } from './utils/logger.js'

const program = new Command()

program
  .name('deckuse')
  .description('Headless, file-native structural operations for PPTX decks')
  .version('0.1.0')

// Init command
program
  .command('init')
  .description('Initialize a workspace from a PPTX file')
  .argument('<pptx>', 'PPTX file to initialize')
  .option('-d, --dir <dir>', 'Workspace directory')
  .action(async (pptx, options) => {
    try {
      await initCommand(pptx, options)
    } catch (error) {
      if (error instanceof Error) {
        if (process.env.DEBUG && error.stack) console.error(error.stack)
        logger.error(error.message)
        process.exit(1)
      }
    }
  })

// Status command
program
  .command('status')
  .description('Show workspace status')
  .argument('<workspace>', 'Workspace directory')
  .action(async (workspace) => {
    try {
      await statusCommand(workspace)
    } catch (error) {
      if (error instanceof Error) {
        if (process.env.DEBUG && error.stack) console.error(error.stack)
        logger.error(error.message)
        process.exit(1)
      }
    }
  })

// Commit command
program
  .command('commit')
  .description('Build workspace back into a PPTX file')
  .argument('<workspace>', 'Workspace directory')
  .option('-o, --output <output>', 'Output PPTX file path')
  .action(async (workspace, options) => {
    try {
      await commitCommand(workspace, options)
    } catch (error) {
      if (error instanceof Error) {
        logger.error(error.message)
        process.exit(1)
      }
    }
  })

// List command
const listCmd = program
  .command('list')
  .description('List structural entities')

listCmd
  .command('slides')
  .description('List all slides')
  .argument('<workspace>', 'Workspace directory')
  .action(async (workspace) => {
    try {
      await listSlidesCommand(workspace)
    } catch (error) {
      if (error instanceof Error) {
        if (process.env.DEBUG && error.stack) console.error(error.stack)
        logger.error(error.message)
        process.exit(1)
      }
    }
  })

// Show command
const showCmd = program
  .command('show')
  .description('Show structural details')

showCmd
  .command('slide')
  .description('Show slide details')
  .argument('<workspace>', 'Workspace directory')
  .argument('<slide>', 'Slide index', parseInt)
  .action(async (workspace, slide) => {
    try {
      await showSlideCommand(workspace, slide)
    } catch (error) {
      if (error instanceof Error) {
        if (process.env.DEBUG && error.stack) console.error(error.stack)
        logger.error(error.message)
        process.exit(1)
      }
    }
  })

// Get command
const getCmd = program
  .command('get')
  .description('Read object properties')

getCmd
  .command('text')
  .description('Get text from a selector')
  .argument('<workspace>', 'Workspace directory')
  .argument('<selector>', 'Selector expression')
  .action(async (workspace, selector) => {
    try {
      await getTextCommand(workspace, selector)
    } catch (error) {
      if (error instanceof Error) {
        if (process.env.DEBUG && error.stack) console.error(error.stack)
        logger.error(error.message)
        process.exit(1)
      }
    }
  })

// Set command
const setCmd = program
  .command('set')
  .description('Set object properties')

setCmd
  .command('text')
  .description('Set text for a selector')
  .argument('<workspace>', 'Workspace directory')
  .argument('<selector>', 'Selector expression')
  .argument('<text>', 'New text content')
  .option('-o, --output <output>', 'Output PPTX file path')
  .action(async (workspace, selector, text, options) => {
    try {
      await setTextCommand(workspace, selector, text, options)
    } catch (error) {
      if (error instanceof Error) {
        if (process.env.DEBUG && error.stack) console.error(error.stack)
        logger.error(error.message)
        process.exit(1)
      }
    }
  })

setCmd
  .command('font-size')
  .description('Set font size for a selector')
  .argument('<workspace>', 'Workspace directory')
  .argument('<selector>', 'Selector expression')
  .argument('<size>', 'Font size in points', parseFloat)
  .option('-o, --output <output>', 'Output PPTX file path')
  .action(async (workspace, selector, size, options) => {
    try {
      await setFontSizeCommand(workspace, selector, size, options)
    } catch (error) {
      if (error instanceof Error) {
        if (process.env.DEBUG && error.stack) console.error(error.stack)
        logger.error(error.message)
        process.exit(1)
      }
    }
  })

// Replace command
program
  .command('replace')
  .description('Replace text globally')
  .argument('<workspace>', 'Workspace directory')
  .argument('<search>', 'Text to search for')
  .argument('<replace>', 'Text to replace with')
  .option('-o, --output <output>', 'Output PPTX file path')
  .option('--slide <slide>', 'Limit to specific slide', parseInt)
  .option('--regex', 'Use regex matching')
  .action(async (workspace, search, replace, options) => {
    try {
      await replaceTextCommand(workspace, search, replace, options)
    } catch (error) {
      if (error instanceof Error) {
        if (process.env.DEBUG && error.stack) console.error(error.stack)
        logger.error(error.message)
        process.exit(1)
      }
    }
  })

program.parse()
