import { CalendarDays, Flag, Flame, Gamepad2, Gift, Globe, Heart, Image, Music, Star, Ticket, Trophy, Users } from 'lucide-react';
export const PAGE_ICON_CHOICES = [
  ['gamepad', 'Controle', Gamepad2], ['flame', 'Chama', Flame], ['trophy', 'Troféu', Trophy], ['calendar', 'Calendário', CalendarDays], ['ticket', 'Ingresso', Ticket], ['users', 'Pessoas', Users], ['star', 'Estrela', Star], ['heart', 'Coração', Heart], ['music', 'Música', Music], ['flag', 'Bandeira', Flag], ['gift', 'Presente', Gift], ['globe', 'Globo', Globe], ['image', 'Imagem', Image], ['none', 'Sem ícone', null],
];
export default function PageIcon({ name, ...props }) { const Icon = PAGE_ICON_CHOICES.find(choice => choice[0] === name)?.[2]; return Icon ? <Icon {...props} /> : null; }
