import { Typography } from 'antd'

import gameData from 'data/game_data.json'
import { Constants, Parts, Sets } from 'lib/constants/constants'
import { ScannerConfig } from 'lib/importer/importConfig'
import { Message } from 'lib/interactions/message'
import { RelicAugmenter } from 'lib/relics/relicAugmenter'
import DB from 'lib/state/db'
import { Utils } from 'lib/utils/utils'
import semver from 'semver'
import stringSimilarity from 'string-similarity'
import { Character } from 'types/character'
import { Relic } from 'types/relic'

// FIXME HIGH

const { Text } = Typography

const characterList = Object.values(gameData.characters)
const lightConeList = Object.values(gameData.lightCones)
const relicSetMatchData = Object.entries(Sets).map(([setKey, setName]) => {
  return {
    setKey: setKey,
    setName: setName,
    lowerAlphaNumericMatcher: lowerAlphaNumeric(setName),
  }
})

type V4ParserLightCone = {
  id: string
  name: string
  level: number
  ascension: number
  superimposition: number
  location: string
  lock: boolean
  _uid: string
}

type V4ParserCharacter = {
  id: string
  name: string
  path: string
  level: number
  ascension: number
  eidolon: number
}

type V4ParserRelic = {
  set_id: string
  name: string
  slot: string
  rarity: number
  level: number
  mainstat: string
  substats: {
    key: string
    value: number
  }[]
  location: string
  lock: boolean
  discard: boolean
  _uid: string
}

const relicSetMapping = gameData.relics.reduce((map, relic) => {
  map[relic.id] = relic
  return map
}, {})

export type ScannerParserJson = {
  source: string
  build: string
  version: number
  metadata: {
    uid: number
    trailblazer: string
    current_trailblazer_path?: string
  }
  characters: V4ParserCharacter[]
  light_cones: V4ParserLightCone[]
  relics: V4ParserRelic[]
}

export class KelzFormatParser { // TODO abstract class
  config: ScannerConfig

  constructor(config: ScannerConfig) {
    this.config = config
  }

  parse(json: ScannerParserJson) {
    const parsed = {
      metadata: {
        trailblazer: 'Stelle',
        current_trailblazer_path: 'Destruction',
      },
      characters: [] as Character[],
      relics: [] as Relic[],
    }

    if (json.source != this.config.sourceString) {
      throw new Error(`Incorrect source string, was '${json.source}', expected '${this.config.sourceString}'`)
    }

    // Temporary while transitioning to v4
    if (json.version != this.config.latestOutputVersion) {
      Message.warning((
        <Text>
          Your scanner version is out of date and may result in incorrect imports! Please update to the latest version from Github:
          {' '}
          <a target='_blank' style={{ color: '#3f8eff' }} href={this.config.releases} rel='noreferrer'>{this.config.releases}</a>
        </Text>
      ), 15)
    }

    if (json.version != 3 && json.version != 4) {
      throw new Error(`Incorrect json version, was '${json.version}', expected '${this.config.latestOutputVersion}'`)
    }

    const buildVersion = json.build || 'v0.0.0'
    const isOutOfDate = semver.lt(buildVersion, this.config.latestBuildVersion)

    if (isOutOfDate) {
      console.log(`Current: ${buildVersion}, Latest: ${this.config.latestBuildVersion}`)
      Message.warning((
        <Text>
          {`Your scanner version ${buildVersion} is out of date and may result in incorrect imports! Please update to the latest version from Github:`}
          {' '}
          <a target='_blank' style={{ color: '#3f8eff' }} href={this.config.releases} rel='noreferrer'>{this.config.releases}</a>
        </Text>
      ), 15)
    }

    let readCharacter
    let readRelic
    if (json.version == 3) {
      readRelic = readRelicV3
      readCharacter = readCharacterV3
    }

    if (json.version == 4) {
      readRelic = readRelicV4
      readCharacter = readCharacterV4
    }

    parsed.metadata.trailblazer = json.metadata.trailblazer || 'Stelle'
    parsed.metadata.current_trailblazer_path = json.metadata.current_trailblazer_path || 'Stelle'

    if (json.relics) {
      parsed.relics = json.relics
        .map((r) => readRelic(r, parsed.metadata.trailblazer, parsed.metadata.current_trailblazer_path, this.config))
        .map((r) => RelicAugmenter.augment(r))
        .filter((r) => {
          if (!r) {
            console.warn('Could not parse relic')
          }
          return r
        })
    }

    if (json.characters) {
      parsed.characters = json.characters
        .map((c) => readCharacter(c, json.light_cones, parsed.metadata.trailblazer, parsed.metadata.current_trailblazer_path))
        .filter((c) => {
          if (!c) {
            console.warn('Could not parse character')
          }
          return c
        })
    }

    return parsed
  }
}

// ================================================== V3 ==================================================
// TODO: deprecate soon
function readCharacterV3(character: V4ParserCharacter & {
  key: string
},
lightCones: (V4ParserLightCone & {
  key: string
})[],
trailblazer,
path) {
  let lightCone: (V4ParserLightCone & {
    key: string
  }) | undefined
  if (lightCones) {
    if (character.key.startsWith('Trailblazer')) {
      lightCone = lightCones.find((x) => x.location === character.key)
      || lightCones.find((x) => x.location.startsWith('Trailblazer'))
    } else {
      lightCone = lightCones.find((x) => x.location === character.key)
    }
  }

  let characterId
  if (character.key.startsWith('Trailblazer')) {
    characterId = getTrailblazerId(character.key, trailblazer, path)
  } else {
    characterId = characterList.find((x) => x.name === character.key)?.id
  }

  const lcKey = lightCone?.key
  const lightConeId = lightConeList.find((x) => x.name === lcKey)?.id

  if (!characterId) return null

  return {
    characterId: characterId,
    characterLevel: character.level || 80,
    characterEidolon: character.eidolon || 0,
    lightCone: lightConeId || null,
    lightConeLevel: lightCone?.level || 80,
    lightConeSuperimposition: lightCone?.superimposition || 1,
  }
}

function readRelicV3(relic, trailblazer, path, config) {
  const partMatches = stringSimilarity.findBestMatch(relic.slot, Object.values(Parts))
  const part = partMatches.bestMatch.target

  const setMatches = stringSimilarity.findBestMatch(lowerAlphaNumeric(relic.set), relicSetMatchData.map((x) => x.lowerAlphaNumericMatcher))
  const set = relicSetMatchData[setMatches.bestMatchIndex].setName

  const enhance = Math.min(Math.max(parseInt(relic.level), 0), 15)
  const grade = Math.min(Math.max(parseInt(relic.rarity), 2), 5)

  const { main, substats } = readRelicStats(relic, part, grade, enhance)

  let equippedBy: string | undefined
  if (relic.location !== '') {
    const lookup = characterList.find((x) => x.name == relic.location)?.id
    if (lookup) {
      equippedBy = lookup
    } else if (relic.location.startsWith('Trailblazer')) {
      equippedBy = getTrailblazerId(relic.location, trailblazer, path)
    }
  }

  return {
    part,
    set,
    enhance,
    grade,
    main,
    substats,
    equippedBy,
    verified: config.speedVerified,
  }
}

// ================================================== V4 ==================================================

function readCharacterV4(character: V4ParserCharacter, lightCones: V4ParserLightCone[]) {
  let lightCone: V4ParserLightCone | undefined
  if (lightCones) {
    // TODO: don't search on an array
    lightCone = lightCones.find((x) => x.location === character.id)
  }

  const characterId = character.id

  const lightConeId = lightCone?.id

  if (!characterId) return null

  return {
    characterId: characterId,
    characterLevel: character.level || 80,
    characterEidolon: character.eidolon || 0,
    lightCone: lightConeId || null,
    lightConeLevel: lightCone?.level || 80,
    lightConeSuperimposition: lightCone?.superimposition || 1,
  }
}

function readRelicV4(relic, trailblazer, path, config) {
  const partMatches = stringSimilarity.findBestMatch(relic.slot, Object.values(Parts))
  const part = partMatches.bestMatch.target

  const setId = relic.set_id
  const set = relicSetMapping[setId].name

  const enhance = Math.min(Math.max(parseInt(relic.level), 0), 15)
  const grade = Math.min(Math.max(parseInt(relic.rarity), 2), 5)

  const { main, substats } = readRelicStats(relic, part, grade, enhance)

  let equippedBy: string | undefined
  if (relic.location !== '') {
    const lookup = characterList.find((x) => x.id == relic.location)?.id
    if (lookup) {
      equippedBy = lookup
    }
  }

  return {
    part,
    set,
    enhance,
    grade,
    main,
    substats,
    equippedBy,
    verified: config.speedVerified,
  }
}

// ================================================== ==================================================

type MainData = {
  base: number
  step: number
}

type Affixes = {
  affix_id: string
  property: string
  base: number
  step: number
}

function readRelicStats(relic, part, grade, enhance) {
  let mainStat
  if (part === 'Hands') {
    mainStat = Constants.Stats.ATK
  } else if (part === 'Head') {
    mainStat = Constants.Stats.HP
  } else {
    mainStat = mapMainStatToId(relic.mainstat)
  }

  const partId = mapPartIdToIndex(part)
  const query = `${grade}${partId}`
  const affixes: Affixes[] = Object.values(DB.getMetadata().relics.relicMainAffixes[query].affixes)

  const mainId = mapAffixIdToString(mainStat)
  const mainData: MainData = affixes.find((x) => x.property === mainId)!
  const mainValue = mainData.base + mainData.step * enhance

  const substats = relic.substats
    .map((s) => ({
      stat: mapSubstatToId(s.key),
      value: s.value,
    }))

  return {
    main: {
      stat: mainStat,
      value: Utils.truncate10000ths(mainValue * (Utils.isFlat(mainStat) ? 1 : 100)),
    },
    substats: substats,
  }
}

function mapSubstatToId(substat) {
  switch (substat) {
    case 'ATK':
      return Constants.Stats.ATK
    case 'HP':
      return Constants.Stats.HP
    case 'DEF':
      return Constants.Stats.DEF
    case 'ATK_':
      return Constants.Stats.ATK_P
    case 'HP_':
      return Constants.Stats.HP_P
    case 'DEF_':
      return Constants.Stats.DEF_P
    case 'SPD':
      return Constants.Stats.SPD
    case 'CRIT Rate_':
      return Constants.Stats.CR
    case 'CRIT DMG_':
      return Constants.Stats.CD
    case 'Effect Hit Rate_':
      return Constants.Stats.EHR
    case 'Effect RES_':
      return Constants.Stats.RES
    case 'Break Effect_':
      return Constants.Stats.BE
    default:
      return null
  }
}

function mapMainStatToId(mainStat) {
  switch (mainStat) {
    case 'ATK':
      return Constants.Stats.ATK_P
    case 'HP':
      return Constants.Stats.HP_P
    case 'DEF':
      return Constants.Stats.DEF_P
    case 'SPD':
      return Constants.Stats.SPD
    case 'CRIT Rate':
      return Constants.Stats.CR
    case 'CRIT DMG':
      return Constants.Stats.CD
    case 'Effect Hit Rate':
      return Constants.Stats.EHR
    case 'Break Effect':
      return Constants.Stats.BE
    case 'Energy Regeneration Rate':
      return Constants.Stats.ERR
    case 'Outgoing Healing Boost':
      return Constants.Stats.OHB
    case 'Physical DMG Boost':
      return Constants.Stats.Physical_DMG
    case 'Fire DMG Boost':
      return Constants.Stats.Fire_DMG
    case 'Ice DMG Boost':
      return Constants.Stats.Ice_DMG
    case 'Lightning DMG Boost':
      return Constants.Stats.Lightning_DMG
    case 'Wind DMG Boost':
      return Constants.Stats.Wind_DMG
    case 'Quantum DMG Boost':
      return Constants.Stats.Quantum_DMG
    case 'Imaginary DMG Boost':
      return Constants.Stats.Imaginary_DMG
    default:
      return null
  }
}

function mapAffixIdToString(affixId: string) {
  switch (affixId) {
    case Constants.Stats.HP_P:
      return 'HPAddedRatio'
    case Constants.Stats.ATK_P:
      return 'AttackAddedRatio'
    case Constants.Stats.DEF_P:
      return 'DefenceAddedRatio'
    case Constants.Stats.HP:
      return 'HPDelta'
    case Constants.Stats.ATK:
      return 'AttackDelta'
    case Constants.Stats.DEF:
      return 'DefenceDelta'
    case Constants.Stats.SPD:
      return 'SpeedDelta'
    case Constants.Stats.CD:
      return 'CriticalDamageBase'
    case Constants.Stats.CR:
      return 'CriticalChanceBase'
    case Constants.Stats.EHR:
      return 'StatusProbabilityBase'
    case Constants.Stats.RES:
      return 'StatusResistanceBase'
    case Constants.Stats.BE:
      return 'BreakDamageAddedRatioBase'
    case Constants.Stats.ERR:
      return 'SPRatioBase'
    case Constants.Stats.OHB:
      return 'HealRatioBase'
    case Constants.Stats.Physical_DMG:
      return 'PhysicalAddedRatio'
    case Constants.Stats.Fire_DMG:
      return 'FireAddedRatio'
    case Constants.Stats.Ice_DMG:
      return 'IceAddedRatio'
    case Constants.Stats.Lightning_DMG:
      return 'ThunderAddedRatio'
    case Constants.Stats.Wind_DMG:
      return 'WindAddedRatio'
    case Constants.Stats.Quantum_DMG:
      return 'QuantumAddedRatio'
    case Constants.Stats.Imaginary_DMG:
      return 'ImaginaryAddedRatio'
    default:
      return null
  }
}

function mapPartIdToIndex(slotId: string) {
  switch (slotId) {
    case Constants.Parts.Head:
      return 1
    case Constants.Parts.Hands:
      return 2
    case Constants.Parts.Body:
      return 3
    case Constants.Parts.Feet:
      return 4
    case Constants.Parts.PlanarSphere:
      return 5
    case Constants.Parts.LinkRope:
      return 6
    default:
      return null
  }
}

function lowerAlphaNumeric(str: string) {
  return str.toLowerCase().replace(/[^a-zA-Z0-9]/g, '')
}

function getTrailblazerId(name: string, trailblazer: string, path: string) {
  if (name === 'TrailblazerDestruction') {
    return trailblazer === 'Stelle' ? '8002' : '8001'
  }
  if (name === 'TrailblazerPreservation') {
    return trailblazer === 'Stelle' ? '8004' : '8003'
  }
  if (name === 'TrailblazerHarmony') {
    return trailblazer === 'Stelle' ? '8006' : '8005'
  }

  if (path === 'Destruction') {
    return trailblazer === 'Stelle' ? '8002' : '8001'
  }
  if (path === 'Preservation') {
    return trailblazer === 'Stelle' ? '8004' : '8003'
  }
  if (path === 'Harmony') {
    return trailblazer === 'Stelle' ? '8006' : '8005'
  }

  return '8002'
}
