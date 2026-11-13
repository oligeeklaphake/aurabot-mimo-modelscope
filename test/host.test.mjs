import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'

const checkout = process.env.MIMO_MODELSCOPE_AURABOT_CHECKOUT
const id = 'mimo-modelscope'

async function waitFor(predicate) {
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    if (predicate()) return
    await delay(50)
  }
  assert.fail('等待模拟 QQ 网关超时')
}

test('官方 Aurabot 加载、面板保护、QQ 命令与本地接口接管', { skip: !checkout && '设置 MIMO_MODELSCOPE_AURABOT_CHECKOUT 以运行官方宿主集成测试', timeout: 30000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'mimo-modelscope-host-test-'))
  const savedEnv = {
    AURABOT_DATA_DIR: root,
    AURABOT_WORKSPACE: join(root, 'workspace'),
    AURABOT_REGISTRY_URL: 'http://127.0.0.1:9/index.json',
  }
  const original = Object.fromEntries(Object.keys(savedEnv).map((key) => [key, process.env[key]]))
  Object.assign(process.env, savedEnv)
  let fake
  let gateway
  t.after(async () => {
    fake?.dispose()
    await gateway?.close()
    await new Promise(setImmediate)
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    rmSync(root, { recursive: true, force: true })
  })
  cpSync(new URL('../modules/' + id + '/', import.meta.url), join(root, 'modules', id), { recursive: true })
  const wav = Buffer.alloc(44)
  wav.write('RIFF', 0)
  wav.write('WAVE', 8)
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+tm1sAAAAASUVORK5CYII=', 'base64')
  const modelIds = []
  const realFetch = globalThis.fetch
  t.mock.method(globalThis, 'fetch', async (src, options) => {
    const url = String(src)
    if (url.startsWith('https://api.xiaomimimo.com/')) {
      return Response.json({ choices: [{ message: { audio: { data: wav.toString('base64') } } }] })
    }
    if (url.endsWith('/images/generations')) {
      modelIds.push(JSON.parse(options.body).model)
      return Response.json({ task_id: 'draw-test' })
    }
    if (url.endsWith('/tasks/draw-test')) {
      return Response.json({ task_status: 'SUCCEED', output_images: ['data:image/png;base64,' + png.toString('base64')] })
    }
    if (gateway && url.startsWith(gateway.httpUrl + '/')) return realFetch(src, options)
    throw new Error('unexpected external request: ' + url)
  })
  const imported = (file) => import(pathToFileURL(join(checkout, file)).href)
  const { startMockOneBot } = await imported('test/helpers/mock-onebot.js')
  gateway = await startMockOneBot({ selfId: '20002' })
  writeFileSync(join(root, 'config.json'), JSON.stringify({
    enabled: true, dryRun: false, setupDone: true, ownerQQ: '10001', botQQ: '20002', gateway: 'onebot',
    voice: { enabled: true }, imageGen: { enabled: true },
    snowluma: {
      autoStart: false, autoAttach: false, dir: join(root, 'no-snowluma'),
      httpUrl: gateway.httpUrl, wsUrl: gateway.wsUrl, httpToken: gateway.token, wsToken: gateway.token,
    },
    ext: { [id]: {
      mimoKey: 'test-mimo', modelScopeToken: 'test-scope',
      imageModels: 'A/Default\nB/Other', imageDefaultModel: 'A/Default',
    } },
  }))
  const { createFakeDsh } = await imported('test/helpers/fake-dsh.js')
  fake = createFakeDsh({ brain: async () => '' })
  const app = (await imported('src/host.js')).apply(fake.ctx)
  await app.ready
  assert.equal(app.modules.running(id), 'user', JSON.stringify(app.modules.status().find((m) => m.id === id)))
  const moduleStatus = app.modules.status().find((m) => m.id === id)
  assert.equal(moduleStatus.tab, 'modules')
  if (process.env.MIMO_MODELSCOPE_EXPECT_NAV_GROUP) assert.equal(moduleStatus.navGroup, 'market')
  const modulePath = '/ext/' + id
  const call = async (path, body) => (await fake.call(modulePath + path, body, {}, '127.0.0.1')).json()
  const initial = await call('/status')
  assert.equal(initial.currentReference.name, '懒羊羊.wav')
  assert.equal(initial.local.tts.enabled, true)
  assert.equal(initial.local.image.enabled, true)
  assert.equal(initial.local.tts.active, true)
  assert.equal(initial.local.image.active, true)
  const remote = await fake.call(modulePath + '/status', undefined, {}, '203.0.113.7')
  assert.equal(remote.status, 403)
  assert.equal((await call('/preview-voice')).ok, false)
  assert.equal((await call('/reference', { base64: wav.toString('base64'), name: '测试音色.wav' })).ok, true)
  assert.equal((await call('/status')).currentReference.name, '测试音色.wav')
  assert.deepEqual(await call('/preview-voice', { text: '晚安' }), { ok: true, url: 'data:audio/wav;base64,' + wav.toString('base64') })
  assert.deepEqual(await call('/preview-image', { prompt: '橘猫', model: 'B/Other' }), { ok: true, url: 'data:image/png;base64,' + png.toString('base64') })
  const state = (await fake.call('/state')).json()
  const publicSettings = state.config.ext[id]
  assert.notEqual(publicSettings.mimoKey, 'test-mimo')
  assert.notEqual(publicSettings.modelScopeToken, 'test-scope')
  assert.ok(app.modules.commands().some((command) => command.module === id && command.name === '画图'))
  const ownerChat = { kind: 'private', chatId: 'private:10001', userId: '10001' }
  const guestChat = { kind: 'private', chatId: 'private:90009', userId: '90009' }
  const ownerToolNames = app.modules.buildTools({ chat: ownerChat, level: 'full', sessionId: 'test-owner' }).map((tool) => tool.name)
  for (const name of ['mimo_say', 'modelscope_draw', 'qq_draw_image']) assert.ok(ownerToolNames.includes(name))
  assert.ok(app.modules.buildTools({ chat: guestChat, level: 'social', sessionId: 'test-guest' }).every((tool) => tool.name !== 'mimo_say' && tool.name !== 'modelscope_draw'))

  await waitFor(() => gateway.connected() > 0 && gateway.sent('get_login_info').length > 0)
  const qq = (messageId, text) => gateway.push({
    message_type: 'private', sub_type: 'friend', user_id: 10001, message_id: messageId,
    sender: { user_id: 10001, nickname: 'Test owner' }, message: [{ type: 'text', data: { text } }],
  })
  const sentSegment = (type) => gateway.sent('send_private_msg').some(({ params }) =>
    String(params.user_id) === '10001' && params.message?.some(({ type: actual }) => actual === type))
  qq(100, '/语音 晚安')
  await waitFor(() => sentSegment('record'))
  qq(101, '/画图 --model B/Other 一只橘猫')
  await waitFor(() => sentSegment('image'))

  const ttsFile = join(root, 'local', 'tts.mjs')
  const imageFile = join(root, 'local', 'image.mjs')
  assert.equal((await call('/local', { slot: 'tts', enabled: true })).ok, true)
  assert.equal((await call('/local', { slot: 'image', enabled: true })).ok, true)
  assert.deepEqual(readFileSync((await app.modules.use('voice').speak('试音')).file), wav)
  assert.deepEqual(await app.modules.use('imagegen').generate('在内置工具里画图'), png)
  assert.deepEqual(modelIds, ['B/Other', 'B/Other', 'A/Default'])

  assert.equal((await call('/local', { slot: 'tts', enabled: false })).ok, true)
  assert.equal(existsSync(ttsFile), false)
  writeFileSync(ttsFile, '// Existing user TTS')
  assert.equal((await call('/local', { slot: 'tts', enabled: true })).ok, false)
  assert.equal(readFileSync(ttsFile, 'utf8'), '// Existing user TTS')
  app.modules.stop(id)
  assert.equal(existsSync(imageFile), false)
  assert.equal(readFileSync(ttsFile, 'utf8'), '// Existing user TTS')
  await app.modules.reload(id)
  assert.equal(existsSync(imageFile), true)
  assert.equal((await call('/local', { slot: 'image', enabled: false })).ok, true)
  assert.equal(existsSync(imageFile), false)
  assert.equal(app.getConfig().local.image, false)
})
