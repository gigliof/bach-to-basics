import unittest
from music21 import midi
from services.music21_svc import _xml_to_midi

SCORE = b'''<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
 <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
 <part id="P1"><measure number="1">
  <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
  <harmony><root><root-step>F</root-step></root><kind>major</kind></harmony>
  <note><pitch><step>A</step><octave>5</octave></pitch><duration>4</duration><type>whole</type></note>
  <note><chord/><pitch><step>C</step><octave>6</octave></pitch><duration>4</duration><type>whole</type></note>
 </measure></part>
</score-partwise>'''

class MusicXmlPlaybackTests(unittest.TestCase):
    def test_chord_labels_are_not_played_but_written_chord_notes_are(self):
        result = midi.MidiFile()
        result.readstr(_xml_to_midi(SCORE, 'practice.musicxml'))
        pitches = [event.pitch for track in result.tracks for event in track.events
                   if isinstance(event, midi.MidiEvent) and event.isNoteOn()]
        self.assertEqual(sorted(pitches), [81, 84])

if __name__ == '__main__':
    unittest.main()
