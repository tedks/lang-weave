// Paraguayan Guaraní starter. See docs/guarani-starter.md for sources and senses.
// The version is a persistent history key. Keep it when adding vocabulary.
// Keep shipped target forms available to the backup reader.
export const GUARANI_PACK = {
  version: '0000000000000001',
  words: [
    ['y', 'water', 1],
    ['yvoty', 'flower', 1],
    ['kuarahy', 'sun', 1],
    ['jasy', 'moon', 1],
    ['ama', 'rain', 1],
    ['yvytu', 'wind', 1],
    ['panambi', 'butterfly', 1],
    ['yva', 'fruit', 1],
    ['yvyra', 'tree', 1],
    ['mainumby', 'hummingbird', 2],
    ['ysapy', 'dew', 2],
    ['ysyry', 'stream', 2],
    ['ytororõ', 'waterfall', 2],
    ['jasyrendy', 'moonlight', 2],
    // Append new Beginner rows after the original pack to keep its ordering.
    ['óga', 'house (dwelling)', 1],
    ['koty', 'room (indoors)', 1],
    ['apyka', 'chair (seat)', 1],
    ['tupa', 'bed (for sleeping)', 1],
    ['mbo’ehao', 'school (for students)', 1],
    ['mbo’ehára', 'teacher (at school)', 1],
    ['aranduka', 'book (printed volume)', 1],
    ['kuatia', 'paper (writing material)', 1],
    // Prose words follow every previously shipped row.
    ['ára', 'day (calendar day)', 1],
    ['pyhare', 'night (after dark)', 1],
    ['okẽ', 'door (movable barrier)', 1],
    ['tata', 'fire (something burning)', 1],
    ['ita', 'stone (piece of rock)', 1],
    ['tape', 'road (route for travel)', 1],
  ].map(([fr, en, level]) => ({ fr, en, level, hint: '' })),
};
