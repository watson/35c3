#!/usr/bin/env node
'use strict'

const pkgName = require('./package').name

process.title = pkgName

const os = require('os')
const fs = require('fs')
const path = require('path')
const download = require('download-to-file')
const xml2js = require('xml2js')
const nearest = require('nearest-date')
const diffy = require('diffy')({ fullscreen: true })
const input = require('diffy/input')()
const trim = require('diffy/trim')
const Grid = require('virtual-grid')
const scrollable = require('scrollable-string')
const Menu = require('menu-string')
const wrap = require('wrap-ansi')
const pad = require('fixed-width-string')
const chalk = require('chalk')
const Configstore = require('configstore')
const argv = require('minimist')(process.argv.slice(2))

const conf = new Configstore(pkgName)
const saved = new Set(conf.get('saved') || [])

const URL = 'https://fahrplan.events.ccc.de/congress/2018/Fahrplan/schedule.xml'
const CACHE = path.join(os.homedir(), '.35c3', 'schedule.xml')
let activeCol = 0
let grid, talk

if (argv.help || argv.h) help()
else if (argv.version || argv.v) version()
else if (argv.update || argv.u) update()
else run()

function help () {
  console.log('Usage: 35c3 [options]')
  console.log()
  console.log('Options:')
  console.log('  --help, -h     Show this help')
  console.log('  --version, -v  Show version')
  console.log('  --update, -u   Update schedule with new changes')
}

function version () {
  console.log(require('./package').version)
}

function update () {
  console.log('Downloading schedule to %s...', CACHE)
  download(URL, CACHE, function (err) {
    if (err) throw err
    run()
  })
}

function run () {
  load(function (err, schedule) {
    if (err) throw err
    initUI(schedule)
    updateTopBar()
  })
}

function load (cb) {
  fs.stat(CACHE, function (err) {
    const filepath = err ? path.join(__dirname, 'schedule.xml') : CACHE
    console.log('Schedule cache:', filepath)
    fs.readFile(filepath, function (err, xml) {
      if (err) return cb(err)
      // Unfortunately error handling is very bad in xml2js, so it will throw
      // if the xml is malformed instead of passing on the error to the
      // callback. Bug report:
      // https://github.com/Leonidas-from-XIV/node-xml2js/issues/408
      try {
        xml2js.parseString(xml, function (err, result) {
          if (err) return cb(err)
          cb(null, result.schedule)
        })
      } catch (e) {
        console.error('Could not parse conference schedule - malformed XML!')
        console.error('Run "35c3 --update" to re-download the schedule')
        process.exit(1)
      }
    })
  })
}

function initUI (schedule) {
  // setup virtual grid
  grid = new Grid([
    [{ height: 2, wrap: false, padding: [0, 1, 0, 0] }, { height: 2, wrap: false, padding: [0, 0, 0, 1] }],
    [{ padding: [0, 1, 0, 0], wrap: false }, { padding: [0, 0, 0, 1], wrap: false }]
  ])

  grid.on('update', function () {
    diffy.render()
  })

  // setup screen
  diffy.on('resize', function () {
    grid.resize(diffy.width, diffy.height)
  })

  diffy.render(function () {
    return grid.toString()
  })

  // generate menu
  const menu = initMenu(schedule)

  menu.on('update', function () {
    grid.update(1, 0, menu.toString())
  })

  menu.select(nearest(menu.items.map(function (item) {
    return item.date
  })))

  // listen for keybord input
  input.on('keypress', function (ch, key) {
    if (ch === 'k') goUp()
    if (ch === 'j') goDown()
    if (ch === 'q') process.exit()
  })
  input.on('up', goUp)
  input.on('down', goDown)
  input.on('space', function () {
    menu.toggleMark()
    const item = menu.selected()
    const id = item.event.$.id
    if (!saved.has(id)) {
      saved.add(id)
    } else {
      saved.delete(id)
    }
    conf.set('saved', Array.from(saved))
  })

  input.on('left', function () {
    activeCol = 0
    updateTopBar()
  })

  input.on('right', function () {
    activeCol = 1
    updateTopBar()
  })

  input.on('tab', function () {
    activeCol = activeCol === 0 ? 1 : 0
    updateTopBar()
  })

  input.on('enter', function () {
    const item = menu.selected()
    talk = scrollable(renderTalk(item.event), {
      maxHeight: grid.cellAt(1, 1).height
    })
    talk.on('update', updateTalk)
    updateTalk()
  })

  function updateTalk () {
    updateTopBar()
    grid.update(1, 1, talk.toString())
  }

  function goUp () {
    if (activeCol === 0) menu.up()
    else if (talk) talk.up()
  }

  function goDown () {
    if (activeCol === 0) menu.down()
    else if (talk) talk.down()
  }
}

function initMenu (schedule) {
  let items = []

  schedule.day.forEach(function (day, index) {
    items.push({ text: 'Day ' + (index + 1), separator: true })

    const events = []

    day.room.forEach(function (room, roomIndex) {
      if (!room.event) return
      room.event.forEach(function (event, index) {
        events.push({
          text: `${event.start}: ${event.title[0]} (${event.room}, ${event.language[0].toUpperCase()})`,
          marked: saved.has(event.$.id),
          event: event,
          date: (new Date(event.date[0])).getTime()
        })
      })
    })

    items = items.concat(events.sort(function (a, b) {
      return a.date - b.date
    }))
  })

  const maxWidth = items.reduce(function (max, item) {
    return item.text.length > max ? item.text.length : max
  }, 0)
  const height = grid.cellAt(1, 0).height

  const menu = new Menu({
    items: items,
    render: function (item, selected) {
      const text = item.separator
        ? item.text
        : `${item.marked ? '\u2714' : ' '} ${item.text}`
      return selected ? chalk.inverse(pad(text, maxWidth)) : text
    },
    height: height
  })

  return menu
}

function renderTopBar (text, active) {
  return active
    ? chalk.black.bgGreen(pad(text, process.stdout.columns))
    : text
}

function updateTopBar () {
  grid.update(0, 0, renderTopBar(` 35c3 schedule - ${chalk.bold('enter:')} details, ${chalk.bold('space:')} favorite, ${chalk.bold('tab:')} switch column`, activeCol === 0))
  grid.update(0, 1, renderTopBar(talk ? `Scroll: ${Math.round(talk.pct() * 100)}%` : '', activeCol === 1))
}

function renderTalk (talk) {
  const cell = grid.cellAt(1, 1)
  const width = cell.width - cell.padding[1] - cell.padding[3]

  const speakers = talk.persons[0].person.map(function (person) {
    return person._
  }).join(', ')

  let body = trim(`
    Room:     ${talk.room[0]}
    Start:    ${talk.start[0]}
    Duration: ${talk.duration[0]}
    Track:    ${talk.track}
    Speakers: ${speakers}

    ${chalk.black.bgYellow('** Title **')}
    ${talk.title[0]}
  `)

  if (talk.subtitle[0]) {
    body = trim(`
      ${body}

      ${chalk.black.bgYellow('** Subtitle **')}
      ${talk.subtitle[0]}
    `)
  }

  body = trim(`
    ${body}

    ${chalk.black.bgYellow('** Abstract **')}
    ${talk.abstract[0]}
  `)

  if (talk.description[0]) {
    body = trim(`
      ${body}

      ${chalk.black.bgYellow('** Description **')}
      ${talk.description[0]}
    `)
  }

  return wrap(body, width)
}
