import { beforeEach } from 'vitest'
import { setLanguage } from './index'

// Deutsch ist die Standardsprache der Tests; Tests, die die Sprache wechseln, sind danach wieder zurückgesetzt.
beforeEach(() => setLanguage('de'))
