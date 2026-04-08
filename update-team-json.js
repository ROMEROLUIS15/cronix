const fs = require('fs');
const path = require('path');

const keys = {
  es: {
    title: 'Equipo', subtitleOnlyYou: 'Solo tú gestionas las citas', subtitleMembers: '{count} empleado(s) en tu equipo',
    addBtn: 'Agregar empleado', addBtnShort: 'Agregar', errNameReq: 'El nombre es obligatorio.',
    toastUpdated: 'Empleado actualizado', toastAdded: 'Empleado agregado al equipo', toastDeleted: 'Empleado eliminado',
    restrictedTitle: 'Acceso restringido', restrictedSub: 'Solo el dueño del negocio puede gestionar el equipo.',
    editTitle: 'Editar empleado', newTitle: 'Nuevo empleado', nameLabel: 'Nombre *', namePlace: 'Ej. Carlos López',
    emailLabel: 'Correo electrónico', emailPlace: 'empleado@correo.com', phoneLabel: 'Teléfono',
    colorLabel: 'Color en agenda', cancelBtn: 'Cancelar', saveChangesBtn: 'Guardar cambios',
    ownerLabel: 'Propietario', ownerBadge: 'Dueño', employeesLabel: 'Empleados',
    noEmployeesTitle: 'No tienes empleados aún', noEmployeesSub: 'Agrega empleados para distribuir citas entre tu equipo',
    addFirstBtn: 'Agregar primer empleado', inactiveBadge: 'Inactivo', noContact: 'Sin datos de contacto',
    btnDeactivate: 'Desactivar', btnActivate: 'Activar'
  },
  en: {
    title: 'Team', subtitleOnlyYou: 'Only you manage appointments', subtitleMembers: '{count} employee(s) in your team',
    addBtn: 'Add employee', addBtnShort: 'Add', errNameReq: 'Name is required.',
    toastUpdated: 'Employee updated', toastAdded: 'Employee added to team', toastDeleted: 'Employee deleted',
    restrictedTitle: 'Restricted access', restrictedSub: 'Only the business owner can manage the team.',
    editTitle: 'Edit employee', newTitle: 'New employee', nameLabel: 'Name *', namePlace: 'E.g. John Doe',
    emailLabel: 'Email', emailPlace: 'employee@email.com', phoneLabel: 'Phone',
    colorLabel: 'Calendar color', cancelBtn: 'Cancel', saveChangesBtn: 'Save changes',
    ownerLabel: 'Owner', ownerBadge: 'Owner', employeesLabel: 'Employees',
    noEmployeesTitle: 'No employees yet', noEmployeesSub: 'Add employees to distribute appointments among your team',
    addFirstBtn: 'Add first employee', inactiveBadge: 'Inactive', noContact: 'No contact data',
    btnDeactivate: 'Deactivate', btnActivate: 'Activate'
  },
  pt: {
    title: 'Equipe', subtitleOnlyYou: 'Só você gerencia os agendamentos', subtitleMembers: '{count} funcionário(s) na sua equipe',
    addBtn: 'Adicionar funcionário', addBtnShort: 'Adicionar', errNameReq: 'O nome é obrigatório.',
    toastUpdated: 'Funcionário atualizado', toastAdded: 'Funcionário adicionado', toastDeleted: 'Funcionário excluído',
    restrictedTitle: 'Acesso restrito', restrictedSub: 'Apenas o dono pode gerenciar a equipe.',
    editTitle: 'Editar funcionário', newTitle: 'Novo funcionário', nameLabel: 'Nome *', namePlace: 'Ex. João Silva',
    emailLabel: 'E-mail', emailPlace: 'funcionario@email.com', phoneLabel: 'Telefone',
    colorLabel: 'Cor na agenda', cancelBtn: 'Cancelar', saveChangesBtn: 'Salvar',
    ownerLabel: 'Proprietário', ownerBadge: 'Dono', employeesLabel: 'Funcionários',
    noEmployeesTitle: 'Sem funcionários', noEmployeesSub: 'Adicione funcionários para distribuir agendamentos',
    addFirstBtn: 'Adicionar funcionário', inactiveBadge: 'Inativo', noContact: 'Sem dados de contato',
    btnDeactivate: 'Desativar', btnActivate: 'Ativar'
  },
  fr: {
    title: 'Équipe', subtitleOnlyYou: 'Vous seul gérez', subtitleMembers: '{count} employé(s)',
    addBtn: 'Ajouter', addBtnShort: 'Ajouter', errNameReq: 'Le nom est requis.',
    toastUpdated: 'Mis à jour', toastAdded: 'Ajouté', toastDeleted: 'Supprimé',
    restrictedTitle: 'Accès restreint', restrictedSub: 'Seul le propriétaire peut gérer.',
    editTitle: 'Éditer', newTitle: 'Nouveau', nameLabel: 'Nom *', namePlace: 'Ex. Jean',
    emailLabel: 'Email', emailPlace: 'email@email.com', phoneLabel: 'Téléphone',
    colorLabel: 'Couleur', cancelBtn: 'Annuler', saveChangesBtn: 'Sauvegarder',
    ownerLabel: 'Propriétaire', ownerBadge: 'Propriétaire', employeesLabel: 'Employés',
    noEmployeesTitle: 'Aucun employé', noEmployeesSub: 'Ajoutez',
    addFirstBtn: 'Ajouter', inactiveBadge: 'Inactif', noContact: 'Aucun contact',
    btnDeactivate: 'Désactiver', btnActivate: 'Activer'
  },
  it: {
    title: 'Squadra', subtitleOnlyYou: 'Solo tu gestisci', subtitleMembers: '{count} dipendente(i)',
    addBtn: 'Aggiungi', addBtnShort: 'Aggiungi', errNameReq: 'Il nome è richiesto.',
    toastUpdated: 'Aggiornato', toastAdded: 'Aggiunto', toastDeleted: 'Eliminato',
    restrictedTitle: 'Accesso limitato', restrictedSub: 'Solo il proprietario può gestire.',
    editTitle: 'Modifica', newTitle: 'Nuovo', nameLabel: 'Nome *', namePlace: 'Es. Mario',
    emailLabel: 'Email', emailPlace: 'email@email.com', phoneLabel: 'Telefono',
    colorLabel: 'Colore', cancelBtn: 'Annulla', saveChangesBtn: 'Salva',
    ownerLabel: 'Proprietario', ownerBadge: 'Proprietario', employeesLabel: 'Dipendenti',
    noEmployeesTitle: 'Nessun dipendente', noEmployeesSub: 'Aggiungi',
    addFirstBtn: 'Aggiungi', inactiveBadge: 'Inattivo', noContact: 'Nessun contatto',
    btnDeactivate: 'Disattiva', btnActivate: 'Attiva'
  },
  de: {
    title: 'Team', subtitleOnlyYou: 'Nur du verwaltest', subtitleMembers: '{count} Mitarbeiter',
    addBtn: 'Hinzufügen', addBtnShort: 'Hinzufügen', errNameReq: 'Name ist erforderlich.',
    toastUpdated: 'Aktualisiert', toastAdded: 'Hinzugefügt', toastDeleted: 'Gelöscht',
    restrictedTitle: 'Eingeschränkt', restrictedSub: 'Nur Eigentümer.',
    editTitle: 'Bearbeiten', newTitle: 'Neu', nameLabel: 'Name *', namePlace: 'Max',
    emailLabel: 'E-Mail', emailPlace: 'email@email.com', phoneLabel: 'Telefon',
    colorLabel: 'Farbe', cancelBtn: 'Abbrechen', saveChangesBtn: 'Speichern',
    ownerLabel: 'Eigentümer', ownerBadge: 'Eigentümer', employeesLabel: 'Mitarbeiter',
    noEmployeesTitle: 'Keine Mitarbeiter', noEmployeesSub: 'Hinzufügen',
    addFirstBtn: 'Hinzufügen', inactiveBadge: 'Inaktiv', noContact: 'Kein Kontakt',
    btnDeactivate: 'Deaktivieren', btnActivate: 'Aktivieren'
  }
};

for (const lang of Object.keys(keys)) {
  const filePath = path.join('messages', `${lang}.json`);
  if (fs.existsSync(filePath)) {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    data.team = keys[lang];
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  }
}
console.log('JSONs updated for team translations!');
