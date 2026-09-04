import { useId } from 'react';

import {
	PERSONALIZATION_NAME_MAX,
	normalizePersonalizationNumber,
} from '../shared/order.js';

/**
 * Os dois campos opcionais de personalização — nome e número. Um único lugar
 * para o markup, o label acessível, o maxlength e o `inputMode` do número.
 * A regra de validação/normalização vive em `shared/order.js` e é aplicada de
 * novo no backend; aqui só cuidamos da digitação.
 *
 * @param {string} noun          - "camiseta" | "Jersey" — vai no label
 * @param {string} name          - valor atual do nome
 * @param {string} number        - valor atual do número
 * @param {(v:string)=>void} onNameChange
 * @param {(v:string)=>void} onNumberChange
 */
export default function PersonalizationFields({
	noun = 'camiseta',
	name,
	number,
	onNameChange,
	onNumberChange,
}) {
	const base = useId();
	const nomeId = `${base}-nome`;
	const numeroId = `${base}-numero`;

	return (
		<>
			<div className="field-group">
				<label className="group-label" htmlFor={nomeId}>
					Nome na {noun} <span className="opt-mark">Opcional</span>
				</label>
				<input
					id={nomeId}
					className="input input-uppercase"
					type="text"
					placeholder="Digite o nome"
					value={name}
					maxLength={PERSONALIZATION_NAME_MAX}
					autoComplete="off"
					onChange={e => onNameChange(e.target.value)}
				/>
			</div>
			<div className="field-group">
				<label className="group-label" htmlFor={numeroId}>
					Número na {noun} <span className="opt-mark">Opcional</span>
				</label>
				<input
					id={numeroId}
					className="input"
					type="text"
					inputMode="numeric"
					pattern="\d*"
					placeholder="Ex.: 23"
					value={number}
					maxLength={2}
					autoComplete="off"
					onChange={e => onNumberChange(normalizePersonalizationNumber(e.target.value))}
				/>
			</div>
		</>
	);
}
