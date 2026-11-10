export const sampleGame = `; Seu arquivo, do seu jeito.
; Este é um exemplo. Salve uma cópia para experimentar.

[Users]
Resolution = 1920x1080
MotionBlur = true
FOV = 65
Graphics = High

[PlayerData]
Name = Pedroca da Parafuseta
Level = 4
HandItem = Sword

[KeyBinds]
Forward = W
Backward = S
Jump = Space
Interact = E

[Sounds]
MasterVolume = 80
MusicVolume = 65
EffectsVolume = 100
Muted = false

[Advanced]
VSync = true
MaxFPS = 144
ShowFPS = false
Language = pt-BR
`;

export const sampleConfig = `; Configura · exemplo de configuração

[Application]
Name = My Application
Version = 1.0.0
Enabled = true

[Network]
Host = localhost
Port = 8080
Timeout = 30
UseSSL = false

[Appearance]
Theme = Dark
Animations = true
Scale = 1.0
`;

export interface EnumPreset { id: string; name: string; values: string[] }
export const defaultPresets: EnumPreset[] = [
  { id: 'resolution', name: 'Resolution', values: ['1280x720', '1366x768', '1600x900', '1920x1080', '2560x1440', '3840x2160'] },
  { id: 'items', name: 'Items', values: ['None', 'Sword', 'Bow', 'Shield', 'Staff'] },
  { id: 'quality', name: 'Quality', values: ['Low', 'Medium', 'High', 'Ultra'] },
  { id: 'difficulty', name: 'Difficulty', values: ['Easy', 'Normal', 'Hard', 'Expert'] },
];

export function guessPreset(key: string): string | undefined {
  if (/resolution|resolucao|resolução/i.test(key)) return 'resolution';
  if (/^(graphics|quality|graphicsquality|texturequality)$/i.test(key)) return 'quality';
  if (/^(handitem|item|weapon)$/i.test(key)) return 'items';
  if (/difficulty|dificuldade/i.test(key)) return 'difficulty';
  return undefined;
}
