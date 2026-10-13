export default {
  nsfw: {
    description: "Configurações e comandos com restrição de idade.",
    persona: {
      description: `Comandos de persona com restrição de idade.`,
      default: {
        description: `Aplicar uma predefinição de personalidade NSFW`,
      },
      import: {
        description: `Importar uma persona a partir de um arquivo PNG, JSON ou CHARX, incluindo personas NSFW`,
      },
    },
    jailbreaks: {
      description: "Gerenciar comportamentos opcionais de jailbreak para meus prompts neste servidor.",
      modal_title: "Gerenciar Estratégias de Jailbreak",
      checkbox_label: "Estratégias de Jailbreak Ativas",
      checkbox_description: "Estratégias marcadas ficam ativadas. Estratégias desmarcadas são desativadas.",
      injection_option: "Injeção de Prompt (reconhecimento +18)",
      unicode_spaces_option: "Substituição de Espaços Unicode",
      sanitize_option: "Higienização de Palavras Sensíveis",
      no_changes_title: "Nenhuma Alteração Feita",
      no_changes_description: "A lista de verificação da estratégia de jailbreak não foi alterada.",
      success_title: "Estratégias de Jailbreak Atualizadas",
      success_description:
        "Suas configurações de estratégia de jailbreak foram atualizadas. **{enabled_count}** opção(ões) estão ativas no momento.",
    },
  },
};
