import { writeFile } from 'fs'
import yaml from 'js-yaml'
import { FilePath, JsonType, Output, Path, TextMap, TextMapPath } from 'lib/i18n/JsonTypes'
import { TsUtils } from 'lib/utils/TsUtils'
import { betaInformation } from 'lib/i18n/betaInformation'

const precisionRound = TsUtils.precisionRound

const inputLocales = ['de_DE', 'en_US', 'es_ES', 'fr_FR', 'id_ID', 'ja_JP', 'ko_KR', 'pt_BR', 'ru_RU', 'th_TH', 'vi_VN', 'zh_CN', 'zh_TW'] as const

const outputLocales = [...inputLocales, 'it_IT'] as const

export type InputLocale = typeof inputLocales[number]

type OutputLocale = typeof outputLocales[number]

// keys must correspond to an available textmap, values are the output locales for a given textmap
// e.g. the english textmap is used for both the english and italian gameData files
const outputLocalesMapping: Record<InputLocale, OutputLocale[]> = {
  de_DE: ['de_DE'],
  en_US: ['en_US', 'it_IT'],
  es_ES: ['es_ES'],
  fr_FR: ['fr_FR'],
  id_ID: ['id_ID'],
  ja_JP: ['ja_JP'],
  ko_KR: ['ko_KR'],
  pt_BR: ['pt_BR'],
  ru_RU: ['ru_RU'],
  th_TH: ['th_TH'],
  vi_VN: ['vi_VN'],
  zh_CN: ['zh_CN'],
  zh_TW: ['zh_TW'],
} as const

//           Destruction, Hunt, Erudition, Harmony, Nihility, Preservation, Abundance, Remembrance
const multiPathIds = [1001, 1224, 8001, 8002, 8003, 8004, 8005, 8006, 8007, 8008] as const
const multiPathIdToPath: Record<typeof multiPathIds[number], Path> = {
  1001: 'Knight',
  1224: 'Rogue',
  8001: 'Warrior',
  8002: 'Warrior',
  8003: 'Knight',
  8004: 'Knight',
  8005: 'Shaman',
  8006: 'Shaman',
  8007: 'Memory',
  8008: 'Memory',
}

const tbNames: Record<InputLocale, { stelle: string; caelus: string }> = {
  de_DE: {
    stelle: 'Stella',
    caelus: 'Caelus',
  },
  en_US: {
    stelle: 'Stelle',
    caelus: 'Caelus',
  },
  es_ES: {
    stelle: 'Estela',
    caelus: 'Caelus',
  },
  fr_FR: {
    stelle: 'Stelle',
    caelus: 'Caelus',
  },
  id_ID: {
    stelle: 'Stelle',
    caelus: 'Caelus',
  },
  ja_JP: {
    stelle: '星',
    caelus: '穹',
  },
  ko_KR: {
    stelle: '스텔레',
    caelus: '카일루스',
  },
  pt_BR: {
    stelle: 'Stelle',
    caelus: 'Caelus',
  },
  ru_RU: {
    stelle: 'Стелла',
    caelus: 'Келус',
  },
  zh_CN: {
    stelle: '星',
    caelus: '穹',
  },
  zh_TW: {
    stelle: '星',
    caelus: '穹',
  },
  th_TH: {
    stelle: 'Stelle',
    caelus: 'Caelus',
  },
  vi_VN: {
    stelle: 'Stelle',
    caelus: 'Caelus',
  },
} as const

const overrides: Partial<Record<InputLocale, { key: string; value: string }[]>> = {
  en_US: [
    {
      key: 'Characters.1213.Name',
      value: 'Imbibitor Lunae',
    },
  ],
  es_ES: [
    {
      key: 'Characters.1213.Name',
      value: 'Imbibitor Lunae',
    },
  ],
  fr_FR: [
    {
      key: 'Characters.1213.Name',
      value: 'Imbibitor Lunae',
    },
  ],
  pt_BR: [
    {
      key: 'Characters.1213.Name',
      value: 'Embebidor Lunae',
    },
  ],
} as const

const InputLocaleToTextMapPath: Record<InputLocale, TextMapPath> = {
  zh_CN: 'TextMap/TextMapCHS',
  zh_TW: 'TextMap/TextMapCHT',
  de_DE: 'TextMap/TextMapDE',
  en_US: 'TextMap/TextMapEN',
  es_ES: 'TextMap/TextMapES',
  fr_FR: 'TextMap/TextMapFR',
  id_ID: 'TextMap/TextMapID',
  ja_JP: 'TextMap/TextMapJP',
  ko_KR: 'TextMap/TextMapKR',
  pt_BR: 'TextMap/TextMapPT',
  ru_RU: 'TextMap/TextMapRU',
  th_TH: 'TextMap/TextMapTH',
  vi_VN: 'TextMap/TextMapVI',
}

function formattingFixer(string: string) {
  if (!string) return ''
  string = string.replace(/<color=#([a-f]|[0-9]){8}>/g, '').replace(/<\/color>/g, '')
  string = string.replace(/<unbreak>/g, '').replace(/<\/unbreak>/g, '')
  return string
}

function replaceParameters(string: string, parameters: number[]) {
  if (!string) return ''
  let output = string
  for (let i = 0; i < parameters.length; i++) {
    const regexstringpercent = `#${i + 1}\\[(i|f[1-9])\\]%`
    const regexstring = `#${i + 1}\\[(i|f[1-9])\\]<`
    const regex = new RegExp(regexstring, 'g')
    const regexpercent = new RegExp(regexstringpercent, 'g')
    output = output
      .replace(regex, `${precisionRound(parameters[i])}<`)
      .replace(regexpercent, `${precisionRound(parameters[i] * 100)}%`)
  }
  return output
}

function cleanString(locale: InputLocale, string: string): string {
  if (!string) return ''
  if (locale !== 'ja_JP') {
    return string
  }
  const regex = /({[^}]*})/g
  return string.replace(regex, '')
}

async function generateTranslations() {
  const pathConfig = await fetchFile('ExcelOutput/AvatarBaseType')
  const avatarConfig = await fetchFile('ExcelOutput/AvatarConfig')
  const damageConfig = await fetchFile('ExcelOutput/DamageType')
  const lightconeConfig = await fetchFile('ExcelOutput/EquipmentConfig')
  const relicSetConfig = await fetchFile('ExcelOutput/RelicSetConfig')
  const relicEffectConfig = await fetchFile('ExcelOutput/RelicSetSkillConfig')
  for (const locale of inputLocales) {
    const textmap = await fetchFile(InputLocaleToTextMapPath[locale])

    const characterBetaInfo = betaInformation[locale]?.Characters ?? betaInformation.en_US?.Characters
    const lightConeBetaInfo = betaInformation[locale]?.Lightcones ?? betaInformation.en_US?.Lightcones
    const relicBetaInfo = betaInformation[locale]?.RelicSets ?? betaInformation.en_US?.RelicSets

    const setEffects: Record<number, { effect2pc: string; effect4pc?: string }> = {}
    for (const effect of relicEffectConfig) {
      if (!setEffects[effect.SetID]) {
        setEffects[effect.SetID] = {
          effect2pc: '',
          effect4pc: '',
        }
      }
      if (effect.RequireNum === 2) {
        setEffects[effect.SetID].effect2pc = formattingFixer(
          replaceParameters(translateKey(effect.SkillDesc, textmap), effect.AbilityParamList.map((x) => x.Value)),
        )
      } else {
        setEffects[effect.SetID].effect4pc = formattingFixer(
          replaceParameters(translateKey(effect.SkillDesc, textmap), effect.AbilityParamList.map((x) => x.Value)),
        )
      }
    }

    const output: Output = { Characters: {}, RelicSets: {}, Lightcones: {}, Paths: {}, Elements: {} }

    for (const path of pathConfig) {
      output.Paths[path.ID ?? 'Unknown'] = cleanString(locale, textmap[path.BaseTypeText.Hash])
    }

    for (const avatar of avatarConfig) {
      const name = avatar.AvatarID > 8000
        ? tbNames[locale][avatar.AvatarID % 2 ? 'caelus' : 'stelle']
        : cleanString(locale, textmap[avatar.AvatarName.Hash])
      output.Characters[avatar.AvatarID] = {
        Name: name,
        LongName: multiPathIds.some((x) => x == avatar.AvatarID)
          ? name + ` (${output.Paths[multiPathIdToPath[avatar.AvatarID as typeof multiPathIds[number]]]})`
          : name,
      }
      if (characterBetaInfo) {
        for (const character of characterBetaInfo) {
          if (output.Characters[character.id]) continue
          output.Characters[character.id] = character.value
        }
      }
    }

    for (const set of relicSetConfig) {
      output.RelicSets[set.SetID] = {
        Name: cleanString(locale, textmap[set.SetName.Hash]),
        Description2pc: setEffects[set.SetID].effect2pc,
        Description4pc: setEffects[set.SetID].effect4pc,
      }
      if (set.SetID > 300) {
        delete output.RelicSets[set.SetID].Description4pc
      }
    }
    if (relicBetaInfo) {
      for (const set of relicBetaInfo) {
        if (output.RelicSets[set.id]) continue
        output.RelicSets[set.id] = set.value
      }
    }

    for (const lightcone of lightconeConfig) {
      output.Lightcones[lightcone.EquipmentID] = {
        Name: cleanString(locale, textmap[lightcone.EquipmentName.Hash]),
      }
    }
    if (lightConeBetaInfo) {
      for (const lightcone of lightConeBetaInfo) {
        if (output.Lightcones[lightcone.id]) continue
        output.Lightcones[lightcone.id] = lightcone.value
      }
    }

    for (const element of damageConfig) {
      output.Elements[element.ID] = cleanString(locale, textmap[element.DamageTypeName.Hash])
    }

    applyOverrides(output, locale)

    for (const outputLocale of outputLocalesMapping[locale]) {
      writeFile(`./public/locales/${outputLocale}/gameData.yaml`, yaml.dump(output, { lineWidth: -1, quotingType: '"' }), (err: unknown) => {
        if (err)
          console.log(err)
        else {
          console.log(`Wrote locale ${locale} to public/locales/${outputLocale}/gameData.yaml successfully\n`)
        }
      })
    }
  }
}

function applyOverrides(output: object, locale: InputLocale) {
  if (!overrides[locale]) return
  for (const override of overrides[locale]) {
    const path = (override.key).split('.')
    let target = output, index = -1
    while (++index < path.length) {
      const key = path[index]
      if (index != path.length - 1) {
        // @ts-ignore
        target = target[key]
      } else {
        // @ts-ignore
        target[key] = override.value
      }
    }
  }
}

// from the readme on Dim's old github repo
function getHash(key: string) {
  let hash1 = 5381
  let hash2 = 5381
  for (let i = 0; i < key.length; i += 2) {
    hash1 = Math.imul((hash1 << 5) + hash1, 1) ^ key.charCodeAt(i)
    if (i === key.length - 1)
      break
    hash2 = Math.imul((hash2 << 5) + hash2, 1) ^ key.charCodeAt(i + 1)
  }
  return Math.imul(hash1 + Math.imul(hash2, 1566083941), 1)
}

function translateHash(hash: number, textmap: TextMap) {
  return textmap[hash]
}

function translateKey(key: string, textmap: TextMap) {
  return translateHash(getHash(key), textmap)
}

async function fetchFile<T extends FilePath>(path: T) {
  console.log(`fetching ${path.split('/').at(-1)}`)
  const response = await fetch(
    `https://gitlab.com/api/v4/projects/Dimbreath%2Fturnbasedgamedata/repository/files/${path.replace('/', '%2F')}.json/raw?ref=main`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    })
  console.log('got response', response.statusText, 'with code', response.status)
  if (response.status !== 200) {
    console.log(response)
  }
  const json: JsonType<T> = await response.json()
  return json
}

await generateTranslations()
