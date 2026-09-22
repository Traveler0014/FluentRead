import {afterEach, describe, expect, it, vi} from 'vitest';
import {
    clearWordDictionaryCache,
    createDefaultWordDictionaryProviders,
    createWordDictionaryLookup,
    lookupWord,
    mergeWordCardData,
    normalizeEnglishWord,
    parseDatamuseWord,
    parseFreeDictionaryEntry,
    parseYoudaoResponse,
    parseWiktApiEntry,
    selectPronunciations,
    type WordCardData,
    type WordDictionaryProvider,
    type WordDictionaryProviderId,
} from '@/src/features/selection-translation/services/wordDictionary';

function response(payload: unknown, ok = true, status = ok ? 200 : 503): Response {
    return {ok, status, json: async () => payload} as Response;
}

function provider(providers: readonly WordDictionaryProvider[], id: WordDictionaryProviderId): WordDictionaryProvider {
    const match = providers.find((item) => item.id === id);
    if (!match) throw new Error(`missing provider ${id}`);
    return match;
}

function card(
    word: string,
    source: WordDictionaryProviderId = 'free-dictionary',
    options: {definition?: string; phonetic?: string} = {},
): WordCardData {
    return {
        word,
        normalizedWord: word,
        phonetics: options.phonetic === undefined ? [{text: '/test/'}] : options.phonetic ? [{text: options.phonetic}] : [],
        meanings: options.definition === undefined
            ? [{partOfSpeech: '名词', definitions: [{definition: 'an English definition'}]}]
            : options.definition
                ? [{partOfSpeech: '名词', definitions: [{definition: options.definition}]}]
                : [],
        sources: [{id: source, label: source, url: 'https://example.test/'}],
    };
}

afterEach(() => {
    clearWordDictionaryCache();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('word dictionary Unicode and untrusted payload boundaries', () => {
    it('normalizes typographic punctuation but rejects empty, oversized and confusable input', () => {
        expect(normalizeEnglishWord("  Rockʼn’Roll  ")).toBe("rock'n'roll");
        expect(normalizeEnglishWord('mother–in‑law')).toBe('mother-in-law');
        expect(normalizeEnglishWord('a'.repeat(64))).toBe('a'.repeat(64));
        expect(normalizeEnglishWord('')).toBeNull();
        expect(normalizeEnglishWord(null as unknown as string)).toBeNull();
        expect(normalizeEnglishWord('a'.repeat(65))).toBeNull();
        expect(normalizeEnglishWord('paypa\u200bl')).toBeNull();
        expect(normalizeEnglishWord('раypal')).toBeNull();
        expect(normalizeEnglishWord('-word')).toBeNull();
    });

    it('accepts only credential-free HTTPS audio URLs and sanitizes dictionary markup', () => {
        const parsed = parseFreeDictionaryEntry({
            phonetics: [
                null,
                {},
                {audio: 'http://cdn.example.test/insecure.mp3'},
                {audio: 'https://user:secret@cdn.example.test/private.mp3'},
                {audio: 'not a url'},
                {audio: '//cdn.example.test/word-uk.mp3'},
                {text: '/us/', audio: 'https://cdn.example.test/word-us.mp3'},
                {text: '/plain/', audio: 'https://cdn.example.test/plain.mp3'},
            ],
            meanings: [
                null,
                {partOfSpeech: 'noun', definitions: 'invalid'},
                {partOfSpeech: 'custom.', definitions: [
                    null,
                    {definition: '<b>A&nbsp;word</b> &amp; sign &#39;x&#x27; &quot;y&quot;', example: '<i>Example</i>'},
                    {definition: '   '},
                ]},
            ],
            phonetic: '/fallback/',
            origin: '<strong>Old&nbsp;origin</strong>',
        }, 'word');

        expect(parsed.phonetics).toEqual([
            {audio: 'https://cdn.example.test/word-uk.mp3', label: '英式'},
            {text: '/us/', audio: 'https://cdn.example.test/word-us.mp3', label: '美式'},
            {text: '/plain/', audio: 'https://cdn.example.test/plain.mp3'},
            {text: '/fallback/'},
        ]);
        expect(parsed.meanings).toEqual([{
            partOfSpeech: 'custom.',
            definitions: [{definition: "A word & sign 'x' \"y\"", example: 'Example'}],
        }]);
        expect(parsed.origin).toBe('Old origin');
    });

    it('merges translations, examples, audio and labels without duplicate rows', () => {
        const base: WordCardData = {
            word: '', normalizedWord: '',
            phonetics: [{text: '/same/'}, {audio: 'https://cdn.example.test/audio.mp3'}],
            meanings: [{partOfSpeech: '名词', definitions: [
                {definition: 'same'},
                {definition: '中文释义'},
                {definition: 'English sense', translatedDefinition: '已有翻译'},
            ]}],
            sources: [],
        };
        const addition: WordCardData = {
            word: 'word', normalizedWord: 'word', origin: 'origin',
            phonetics: [
                {text: '/same/', audio: 'https://cdn.example.test/same.mp3', label: '美式'},
                {audio: 'https://cdn.example.test/audio.mp3', label: '英式'},
                {},
            ],
            meanings: [{partOfSpeech: 'noun', definitions: [{
                definition: 'same', example: 'An example', translatedDefinition: '相同', translatedExample: '一个例子',
            }]}, {partOfSpeech: '名词', definitions: [
                {definition: 'Replacement English', example: 'Replacement example', translatedExample: '替换例句'},
                {definition: '新增中文'},
                {definition: '已有翻译'},
            ]}],
            sources: [{id: 'wiktapi', label: 'WiktApi', url: 'https://wiktapi.dev/'}],
        };

        const merged = mergeWordCardData(base, addition);

        expect(merged).toMatchObject({word: 'word', normalizedWord: 'word', origin: 'origin'});
        expect(merged.phonetics).toEqual([
            {text: '/same/', audio: 'https://cdn.example.test/same.mp3', label: '美式'},
            {audio: 'https://cdn.example.test/audio.mp3', label: '英式'},
        ]);
        expect(merged.meanings[0]?.definitions[0]).toEqual({
            definition: 'same', example: 'An example',
            translatedDefinition: '相同；新增中文；已有翻译', translatedExample: '一个例子',
        });
        expect(merged.meanings[0]?.definitions[1]).toEqual({
            definition: 'Replacement English', example: 'Replacement example', translatedExample: '替换例句',
        });
        expect(merged.meanings[0]?.definitions[2]?.translatedDefinition).toBe('已有翻译');
        expect(merged.sources.map((source) => source.id)).toEqual(['wiktapi']);
        expect(mergeWordCardData(merged, {
            word: '', normalizedWord: '', phonetics: [], meanings: [], sources: [],
        }).normalizedWord).toBe('word');
    });

    it('enforces definition and meaning caps while preserving distinct senses', () => {
        const definitions = Array.from({length: 8}, (_, index) => ({definition: `sense ${index}`}));
        const initial = mergeWordCardData(null, {
            word: 'cap', normalizedWord: 'cap', phonetics: [],
            meanings: [{partOfSpeech: '', definitions}, {partOfSpeech: 'noun', definitions: []}],
            sources: [],
        });
        for (const partOfSpeech of ['verb', 'adjective', 'adverb', 'pronoun', 'preposition', 'article']) {
            mergeWordCardData(initial, {
                word: 'cap', normalizedWord: 'cap', phonetics: [], sources: [],
                meanings: [{partOfSpeech, definitions: [{definition: partOfSpeech}]}],
            });
        }
        mergeWordCardData(initial, {
            word: 'cap', normalizedWord: 'cap', phonetics: [], sources: [],
            meanings: [{partOfSpeech: '其他', definitions: [{definition: 'sense 0'}, {definition: 'sense 9'}]}],
        });

        expect(initial.meanings).toHaveLength(6);
        expect(initial.meanings[0]?.partOfSpeech).toBe('其他');
        expect(initial.meanings[0]?.definitions).toHaveLength(6);
    });

    it('selects at most two unlabelled pronunciations and handles a single regional row', () => {
        expect(selectPronunciations([{text: 'a'}, {text: 'b'}, {text: 'c'}])).toEqual([{text: 'a'}, {text: 'b'}]);
        expect(selectPronunciations([
            {text: '/weak/', label: '美式'},
            {text: '/ˈprimary/', label: '美式'},
        ])).toEqual([{text: '/ˈprimary/', label: '美式'}]);
        expect(selectPronunciations([
            {audio: 'https://cdn.example.test/plain.mp3', label: '美式'},
            {audio: 'https://cdn.example.test/primary.mp3', label: '美式'},
        ])).toEqual([{audio: 'https://cdn.example.test/primary.mp3', label: '美式'}]);
    });
});

describe('word dictionary defensive provider parsing', () => {
    it('handles alternate Youdao shapes, invalid rows and pronunciation candidates', () => {
        expect(parseYoudaoResponse(null, 'word').meanings).toEqual([]);
        expect(parseYoudaoResponse({ec: {word: 'invalid'}}, 'word').phonetics).toEqual([]);
        const parsed = parseYoudaoResponse({
            ec: {word: {ukphone: 'fallback; ignored', trs: [null, {pos: '', tran: '   '}, {pos: 'adj.', tran: '<b>可用</b>'}]}},
            simple: {word: [null, {multiPhone: {uk: [null, {}, {phone: 'wə'}, {phone: 'ˈwɜːd', speech: 'word&type=1'}]}}]},
        }, 'word');

        expect(parsed.phonetics).toEqual([{
            text: '/ˈwɜːd/', audio: 'https://dict.youdao.com/dictvoice?word&type=1', label: '英式',
        }]);
        expect(parsed.meanings[0]).toEqual({
            partOfSpeech: '形容词', definitions: [{definition: '可用', translatedDefinition: '可用'}],
        });
        expect(parseYoudaoResponse({ec: {word: {ukphone: 'uk'}}, simple: 'invalid'}, 'word').phonetics[0]?.audio)
            .toBe('https://dict.youdao.com/dictvoice?audio=word&type=1');
        expect(parseYoudaoResponse({
            ec: {word: {}},
            simple: [{multiPhone: {uk: [{phone: 'ˈnoaudio'}]}}],
        }, 'word').phonetics).toEqual([{
            text: '/ˈnoaudio/', audio: 'https://dict.youdao.com/dictvoice?audio=word&type=1', label: '英式',
        }]);
    });

    it('defensively parses Free Dictionary, WiktApi and Datamuse variants', () => {
        expect(parseFreeDictionaryEntry({word: 1, phonetics: 'invalid', meanings: 'invalid', origin: 1}, 'free'))
            .toMatchObject({word: 'free', phonetics: [], meanings: []});

        const wikt = parseWiktApiEntry({
            word: 'sound',
            senses: [null, {glosses: 'invalid'}, {glosses: [null, 'a sound'], examples: [null, {text: ''}, {text: 'Sound example.'}]}],
            sounds: [
                null,
                {enpr: 'saund', ogg_url: '//cdn.example.test/sound.ogg', tags: ['British']},
                {audio: 'https://cdn.example.test/sound.mp3', tags: ['US']},
                {ipa: '/other/', tags: 'invalid'},
            ],
        }, 'sound');
        expect(wikt.meanings[0]?.definitions).toEqual([{definition: 'a sound', example: 'Sound example.'}]);
        expect(wikt.phonetics.map((item) => item.label)).toEqual(['英式', '美式', undefined]);
        expect(parseWiktApiEntry({senses: 'invalid', sounds: 'invalid'}, 'empty')).toMatchObject({
            meanings: [], phonetics: [],
        });

        expect(parseDatamuseWord({word: 'other'}, 'word').meanings).toEqual([]);
        const datamuse = parseDatamuseWord({word: 'word', tags: 'invalid', defs: ['', 'A definition without tag', 'v\tto express', 'v\tto state']}, 'word');
        expect(datamuse.meanings).toEqual([
            {partOfSpeech: '其他', definitions: [{definition: 'A definition without tag'}]},
            {partOfSpeech: '动词', definitions: [{definition: 'to express'}, {definition: 'to state'}]},
        ]);
        expect(parseDatamuseWord({word: 'word', tags: ['pron:/wɜːd/'], defs: 'invalid'}, 'word').phonetics)
            .toEqual([{text: '/wɜːd/'}]);
    });
});

describe('word dictionary provider network adapters', () => {
    it('validates each remote provider payload and merges only matching English entries', async () => {
        const providers = createDefaultWordDictionaryProviders();
        vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('dict.youdao.com')) return response({ec: {word: {usphone: 'us', trs: [{pos: 'n', tran: '词'}]}}});
            if (url.includes('dictionaryapi.dev')) return response([null, {word: 'word', meanings: [{partOfSpeech: 'noun', definitions: [{definition: 'definition'}]}]}]);
            if (url.includes('api.datamuse.com')) return response([null, {word: 'other'}, {word: 'word', defs: ['n\tdefinition']}]);
            if (url.includes('en.wiktionary.org')) return response({en: [
                null,
                {partOfSpeech: 'verb', definitions: 'invalid'},
                {partOfSpeech: 'noun', definitions: [
                    null,
                    {definition: '<b>definition</b>', examples: [null, {example: ''}, {example: 'example'}]},
                    {definition: 'without example', examples: 'invalid'},
                ]},
            ]});
            if (url.includes('api.wiktapi.dev')) return response({entries: [null, {lang_code: 'fr', senses: [{glosses: ['French']}]}, {lang_code: '', pos: 'noun', senses: [{glosses: ['English']}]}]});
            throw new Error(`unexpected ${url}`);
        }));

        expect((await provider(providers, 'youdao-web').lookup('word'))?.phonetics).toHaveLength(1);
        expect((await provider(providers, 'free-dictionary').lookup('word'))?.meanings[0]?.definitions[0]?.definition).toBe('definition');
        expect((await provider(providers, 'datamuse').lookup('word'))?.meanings[0]?.definitions[0]?.definition).toBe('definition');
        expect((await provider(providers, 'wiktionary-rest').lookup('word'))?.meanings[0]?.definitions).toEqual([
            {definition: 'definition', example: 'example'},
            {definition: 'without example'},
        ]);
        expect((await provider(providers, 'wiktapi').lookup('word'))?.meanings[0]?.definitions[0]?.definition).toBe('English');
    });

    it('returns null for structurally invalid remote payloads and rejects HTTP/JSON failures', async () => {
        const providers = createDefaultWordDictionaryProviders();
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(response({}, false, 429))
            .mockResolvedValueOnce({ok: true, status: 200, json: async () => { throw new SyntaxError('secret'); }} as unknown as Response)
            .mockResolvedValue(response(null));
        vi.stubGlobal('fetch', fetchMock);

        await expect(provider(providers, 'youdao-web').lookup('word')).rejects.toThrow('dictionary request failed: 429');
        await expect(provider(providers, 'free-dictionary').lookup('word')).rejects.toThrow('dictionary response is not valid JSON');
        expect(await provider(providers, 'free-dictionary').lookup('word')).toBeNull();
        expect(await provider(providers, 'datamuse').lookup('word')).toBeNull();
        expect(await provider(providers, 'wiktionary-rest').lookup('word')).toBeNull();
        expect(await provider(providers, 'wiktapi').lookup('word')).toBeNull();
    });

    it('treats empty provider-specific containers as a clean miss', async () => {
        const providers = createDefaultWordDictionaryProviders();
        const payloads = [{}, {entries: 'invalid'}, {en: 'invalid'}];
        vi.stubGlobal('fetch', vi.fn(async () => response(payloads.shift())));

        expect(await provider(providers, 'youdao-web').lookup('word')).toBeNull();
        expect(await provider(providers, 'wiktapi').lookup('word')).toBeNull();
        expect(await provider(providers, 'wiktionary-rest').lookup('word')).toBeNull();
    });

    it('aborts a slow WiktApi request at its provider timeout', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        })));
        const pending = provider(createDefaultWordDictionaryProviders(), 'wiktapi').lookup('slow');
        const rejected = expect(pending).rejects.toMatchObject({name: 'AbortError'});
        await vi.advanceTimersByTimeAsync(1_200);
        await rejected;
    });
});

describe('word dictionary lookup orchestration', () => {
    it('validates cache capacity', () => {
        expect(() => createWordDictionaryLookup({cacheSize: 0})).toThrow('词典缓存容量必须是正整数');
        expect(() => createWordDictionaryLookup({cacheSize: 1.5})).toThrow('词典缓存容量必须是正整数');
    });

    it('caches positive and negative results and clearCache makes them queryable again', async () => {
        const lookup = vi.fn(async (word: string) => word === 'found' ? card(word) : null);
        const dictionary = createWordDictionaryLookup({providers: [{id: 'free-dictionary', lookup}], cacheSize: 2});

        expect(await dictionary.lookup('found')).not.toBeNull();
        expect(await dictionary.lookup('FOUND')).not.toBeNull();
        expect(await dictionary.lookup('missing')).toBeNull();
        expect(await dictionary.lookup('missing')).toBeNull();
        expect(lookup).toHaveBeenCalledTimes(2);
        dictionary.clearCache();
        expect(await dictionary.lookup('found')).not.toBeNull();
        expect(lookup).toHaveBeenCalledTimes(3);
    });

    it('deduplicates concurrent lookups and evicts the oldest cached result', async () => {
        let release: ((value: WordCardData) => void) | undefined;
        const slowLookup = vi.fn((_word: string) => new Promise<WordCardData>((resolve) => { release = resolve; }));
        const concurrent = createWordDictionaryLookup({providers: [{id: 'free-dictionary', lookup: slowLookup}], cacheSize: 1});
        const first = concurrent.lookup('same');
        const second = concurrent.lookup('same');
        release?.(card('same'));
        await expect(Promise.all([first, second])).resolves.toHaveLength(2);
        expect(slowLookup).toHaveBeenCalledTimes(1);

        const eagerLookup = vi.fn(async (word: string) => card(word));
        const eviction = createWordDictionaryLookup({providers: [{id: 'free-dictionary', lookup: eagerLookup}], cacheSize: 1});
        await eviction.lookup('one');
        await eviction.lookup('two');
        await eviction.lookup('one');
        expect(eagerLookup).toHaveBeenCalledTimes(3);
    });

    it('isolates provider failures and waits for all completeness conditions before stopping', async () => {
        const warning = vi.fn();
        const neverReached = vi.fn(async () => card('word'));
        const dictionary = createWordDictionaryLookup({
            warn: warning,
            providers: [
                {id: 'free-dictionary', lookup: async () => { throw new Error('local failed'); }},
                {id: 'free-dictionary', lookup: async () => ({
                    word: 'word', normalizedWord: 'word', phonetics: [], meanings: [], sources: [],
                })},
                {id: 'free-dictionary', lookup: async () => card('word', 'free-dictionary', {phonetic: ''})},
                {id: 'youdao-web', lookup: async () => card('word', 'youdao-web', {definition: '中文', phonetic: ''})},
                {id: 'datamuse', lookup: async () => card('word', 'datamuse')},
                {id: 'wiktapi', lookup: neverReached},
            ],
        });

        const result = await dictionary.lookup('word');
        expect(result?.sources.map((source) => source.id)).toEqual(['free-dictionary', 'youdao-web', 'datamuse']);
        expect(warning).toHaveBeenCalledOnce();
        expect(neverReached).not.toHaveBeenCalled();
    });

    it('uses the default warning sink and skips providers for invalid input', async () => {
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const providerLookup = vi.fn(async () => { throw new Error('offline'); });
        const dictionary = createWordDictionaryLookup({providers: [{id: 'datamuse', lookup: providerLookup}]});

        expect(await dictionary.lookup('two words')).toBeNull();
        expect(providerLookup).not.toHaveBeenCalled();
        expect(await dictionary.lookup('valid')).toBeNull();
        expect(warning).toHaveBeenCalledOnce();
    });

    it('keeps the exported default lookup and cache reset operational', async () => {
        const fetchMock = vi.fn(async () => response({ec: {word: {usphone: 'v', trs: [{pos: 'n', tran: 'valid 有效'}]}}}));
        vi.stubGlobal('fetch', fetchMock);
        expect(await lookupWord('edgecache')).not.toBeNull();
        expect(await lookupWord('edgecache')).not.toBeNull();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        clearWordDictionaryCache();
        expect(await lookupWord('edgecache')).not.toBeNull();
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});
