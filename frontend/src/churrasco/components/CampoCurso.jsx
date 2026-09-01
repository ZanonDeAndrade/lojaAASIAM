import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

/**
 * Lista de cursos própria da AASIAM.
 *
 * O `<select>` nativo abre o menu cinza do sistema, que ignora qualquer estilo
 * e destoa da página. Aqui o campo é um combobox de seleção única no padrão
 * WAI-ARIA: o foco fica sempre no gatilho e o teclado responde como no nativo
 * (setas, Home/End, Enter, Escape e busca por letra).
 *
 * Não existe `<select>` escondido por trás — o valor vive no estado do
 * formulário, então não há dois campos concorrendo pelo mesmo dado.
 */
export default function CampoCurso({
	id,
	opcoes,
	valor,
	aoEscolher,
	aoSair,
	invalido,
	descritoPor,
	desabilitado,
	placeholder = 'Selecione seu curso',
	rotuloDaLista = 'Cursos disponíveis',
}) {
	const [aberto, setAberto] = useState(false);
	const [focado, setFocado] = useState(-1);
	// No celular o campo costuma ficar perto do fim da tela; nesse caso a lista
	// sobe em vez de descer, para caber sem empurrar nada.
	const [paraCima, setParaCima] = useState(false);

	const raizRef = useRef(null);
	const gatilhoRef = useRef(null);
	const listaRef = useRef(null);
	const buscaRef = useRef({ texto: '', em: 0 });

	const baseId = useId();
	const idDaLista = `${baseId}-lista`;
	const idDaOpcao = (indice) => `${baseId}-opcao-${indice}`;

	const selecionado = opcoes.indexOf(valor);

	/** Altura máxima da lista, espelhando o CSS. */
	function alturaDaLista() {
		return Math.min(330, window.innerHeight * 0.58);
	}

	function abrir(indiceInicial = selecionado >= 0 ? selecionado : 0) {
		if (desabilitado) return;

		const caixa = gatilhoRef.current?.getBoundingClientRect();
		if (caixa) {
			const abaixo = window.innerHeight - caixa.bottom;
			const acima = caixa.top;
			setParaCima(abaixo < alturaDaLista() + 24 && acima > abaixo);
		}

		setFocado(indiceInicial);
		setAberto(true);
	}

	function fechar({ devolverFoco = true } = {}) {
		setAberto(false);
		setFocado(-1);
		if (devolverFoco) gatilhoRef.current?.focus();
	}

	function escolher(indice) {
		const curso = opcoes[indice];
		if (!curso) return;
		aoEscolher(curso);
		fechar();
	}

	/* Mantém a opção em foco visível quando a lista rola. */
	useEffect(() => {
		if (!aberto || focado < 0) return;
		listaRef.current
			?.querySelector(`#${CSS.escape(idDaOpcao(focado))}`)
			?.scrollIntoView({ block: 'nearest' });
	}, [aberto, focado]);

	/* Clique fora fecha — sem devolver o foco, que já foi para outro lugar. */
	useEffect(() => {
		if (!aberto) return undefined;

		function aoApontarFora(evento) {
			if (raizRef.current?.contains(evento.target)) return;
			setAberto(false);
			setFocado(-1);
			aoSair?.();
		}

		document.addEventListener('pointerdown', aoApontarFora);
		return () => document.removeEventListener('pointerdown', aoApontarFora);
	}, [aberto, aoSair]);

	/** Busca por letra: digitar "g" salta para Gastronomia. */
	function buscarPorTexto(tecla) {
		const agora = Date.now();
		const busca = buscaRef.current;
		busca.texto = agora - busca.em > 700 ? tecla : busca.texto + tecla;
		busca.em = agora;

		const alvo = busca.texto.toLowerCase();
		const inicio = Math.max(0, focado);
		const ordem = [...opcoes.slice(inicio + 1), ...opcoes.slice(0, inicio + 1)];
		const achado = ordem.find((curso) => curso.toLowerCase().startsWith(alvo));
		if (!achado) return;

		const indice = opcoes.indexOf(achado);
		if (aberto) setFocado(indice);
		else aoEscolher(achado);
	}

	function aoTeclar(evento) {
		const { key, altKey } = evento;

		if (key === 'Escape') {
			if (aberto) {
				evento.preventDefault();
				fechar();
			}
			return;
		}

		if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
			evento.preventDefault();
			if (aberto) escolher(focado);
			else abrir();
			return;
		}

		if (key === 'Tab') {
			if (aberto) fechar({ devolverFoco: false });
			return;
		}

		if (key === 'ArrowDown') {
			evento.preventDefault();
			if (!aberto) return abrir(altKey ? undefined : Math.max(0, selecionado));
			return setFocado((atual) => Math.min(opcoes.length - 1, atual + 1));
		}

		if (key === 'ArrowUp') {
			evento.preventDefault();
			if (!aberto) return abrir();
			return setFocado((atual) => Math.max(0, atual - 1));
		}

		if (key === 'Home') {
			evento.preventDefault();
			if (!aberto) return abrir(0);
			return setFocado(0);
		}

		if (key === 'End') {
			evento.preventDefault();
			const ultimo = opcoes.length - 1;
			if (!aberto) return abrir(ultimo);
			return setFocado(ultimo);
		}

		if (key.length === 1 && /\S/.test(key) && !evento.metaKey && !evento.ctrlKey) {
			evento.preventDefault();
			buscarPorTexto(key);
		}

		return undefined;
	}

	return (
		<div className="ch-combo" ref={raizRef}>
			<button
				type="button"
				id={id}
				ref={gatilhoRef}
				className={`ch-combo-gatilho${valor ? '' : ' is-vazio'}`}
				role="combobox"
				aria-expanded={aberto}
				aria-controls={idDaLista}
				aria-haspopup="listbox"
				aria-activedescendant={aberto && focado >= 0 ? idDaOpcao(focado) : undefined}
				aria-invalid={invalido ? 'true' : undefined}
				aria-describedby={descritoPor}
				disabled={desabilitado}
				onClick={() => (aberto ? fechar() : abrir())}
				onKeyDown={aoTeclar}
				onBlur={() => {
					// Ao sair para outro campo o formulário revalida; com a lista
					// aberta o foco continua aqui, então não é uma saída de verdade.
					if (!aberto) aoSair?.();
				}}
			>
				<span className="ch-combo-valor">{valor || placeholder}</span>
				<ChevronDown className="ch-combo-seta" size={18} aria-hidden="true" />
			</button>

			{aberto && (
				<ul
					className={`ch-combo-lista${paraCima ? ' is-acima' : ''}`}
					id={idDaLista}
					ref={listaRef}
					role="listbox"
					aria-label={rotuloDaLista}
					tabIndex={-1}
				>
					{opcoes.map((curso, indice) => {
						const estaSelecionado = curso === valor;
						const estaEmFoco = indice === focado;
						return (
							<li
								key={curso}
								id={idDaOpcao(indice)}
								role="option"
								aria-selected={estaSelecionado}
								className={[
									'ch-combo-opcao',
									estaEmFoco ? 'is-foco' : '',
									estaSelecionado ? 'is-selecionada' : '',
								]
									.filter(Boolean)
									.join(' ')}
								// pointerdown em vez de click: escolhe antes que o
								// blur do gatilho feche a lista.
								onPointerDown={(evento) => {
									evento.preventDefault();
									escolher(indice);
								}}
								onPointerMove={() => setFocado(indice)}
							>
								<span>{curso}</span>
								{estaSelecionado && <Check size={16} aria-hidden="true" />}
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}
