let currentToken = null;
let currentPage = 1;
let currentUserId = null;

// Authentication
async function login() {
    const login = document.getElementById('adminLogin').value;
    const password = document.getElementById('adminPassword').value;

    try {
        const response = await fetch('/api/admin/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                admin_login: login,
                admin_password: password
            })
        });

        const data = await response.json();

        if (data.success) {
            currentToken = data.token;
            localStorage.setItem('adminToken', currentToken);
            document.getElementById('loginForm').style.display = 'none';
            document.getElementById('adminPanel').style.display = 'block';
            loadStats();
            loadUsers();
            
            // Initialize tabs
            switchTab('users');
        } else {
            showAlert('Authentication error: ' + data.message, 'error');
        }
    } catch (error) {
        showAlert('Server connection error', 'error');
    }
}

// Logout
function logout() {
    currentToken = null;
    localStorage.removeItem('adminToken');
    document.getElementById('loginForm').style.display = 'block';
    document.getElementById('adminPanel').style.display = 'none';
}

// Check token on load
window.onload = function() {
    const token = localStorage.getItem('adminToken');
    if (token) {
        currentToken = token;
        document.getElementById('loginForm').style.display = 'none';
        document.getElementById('adminPanel').style.display = 'block';
        loadStats();
        loadUsers();
        
        // Initialize tabs
        switchTab('users');
    }
};

// Load statistics
async function loadStats() {
    try {
        const response = await fetch('/api/admin/stats', {
            headers: {
                'Authorization': 'Bearer ' + currentToken
            }
        });

        const data = await response.json();

        if (data.success) {
            const stats = data.data;
            document.getElementById('statsGrid').innerHTML = `
                <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                    <div class="flex items-center">
                        <div class="flex-shrink-0">
                            <div class="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                                <svg class="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z"></path>
                                </svg>
                            </div>
                        </div>
                        <div class="ml-4">
                            <p class="text-sm font-medium text-gray-500">Total Users</p>
                            <p class="text-2xl font-semibold text-gray-900">${stats.totalUsers}</p>
                        </div>
                    </div>
                </div>
                <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                    <div class="flex items-center">
                        <div class="flex-shrink-0">
                            <div class="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                                <svg class="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                                </svg>
                            </div>
                        </div>
                        <div class="ml-4">
                            <p class="text-sm font-medium text-gray-500">Active Users</p>
                            <p class="text-2xl font-semibold text-gray-900">${stats.activeUsers}</p>
                        </div>
                    </div>
                </div>
                <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                    <div class="flex items-center">
                        <div class="flex-shrink-0">
                            <div class="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
                                <svg class="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"></path>
                                </svg>
                            </div>
                        </div>
                        <div class="ml-4">
                            <p class="text-sm font-medium text-gray-500">Premium Users</p>
                            <p class="text-2xl font-semibold text-gray-900">${stats.premiumUsers}</p>
                        </div>
                    </div>
                </div>
                <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                    <div class="flex items-center">
                        <div class="flex-shrink-0">
                            <div class="w-8 h-8 bg-yellow-100 rounded-lg flex items-center justify-center">
                                <svg class="w-5 h-5 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"></path>
                                </svg>
                            </div>
                        </div>
                        <div class="ml-4">
                            <p class="text-sm font-medium text-gray-500">New This Week</p>
                            <p class="text-2xl font-semibold text-gray-900">${stats.recentUsers}</p>
                        </div>
                    </div>
                </div>
            `;
        }
    } catch (error) {
        console.error('Error loading statistics:', error);
    }
}

// Load users
async function loadUsers(page = 1) {
    try {
        const search = document.getElementById('userSearch').value;
        const role = document.getElementById('roleFilter').value;
        
        let url = `/api/admin/users?page=${page}`;
        if (search) url += `&search=${encodeURIComponent(search)}`;
        if (role) url += `&role=${role}`;

        const response = await fetch(url, {
            headers: {
                'Authorization': 'Bearer ' + currentToken
            }
        });

        const data = await response.json();

        if (data.success) {
            displayUsers(data.data.users);
            displayPagination(data.data.pagination, 'usersPagination', loadUsers);
        }
    } catch (error) {
        console.error('Error loading users:', error);
    }
}

// Display users
function displayUsers(users) {
    const tbody = document.getElementById('usersTableBody');
    tbody.innerHTML = '';

    users.forEach(user => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${user.id}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${user.username}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${user.email}</td>
            <td class="px-6 py-4 whitespace-nowrap">
                <span class="inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                    user.role === 'admin' ? 'bg-red-100 text-red-800' :
                    user.role === 'premium' ? 'bg-purple-100 text-purple-800' :
                    'bg-green-100 text-green-800'
                }">
                    ${user.role}
                </span>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${new Date(user.created_at).toLocaleDateString()}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                <button class="btn-edit text-blue-600 hover:text-blue-900" data-user-id="${user.id}">Edit</button>
                <button class="btn-subscription text-green-600 hover:text-green-900" data-user-id="${user.id}">Subscription</button>
                <button class="btn-delete text-red-600 hover:text-red-900" data-user-id="${user.id}">Delete</button>
            </td>
        `;
        tbody.appendChild(row);
    });

    // Add event listeners
    tbody.querySelectorAll('.btn-edit').forEach(btn => {
        btn.addEventListener('click', () => editUser(btn.dataset.userId));
    });
    tbody.querySelectorAll('.btn-subscription').forEach(btn => {
        btn.addEventListener('click', () => manageSubscription(btn.dataset.userId));
    });
    tbody.querySelectorAll('.btn-delete').forEach(btn => {
        btn.addEventListener('click', () => deleteUser(btn.dataset.userId));
    });
}

// Load subscriptions
async function loadSubscriptions(page = 1) {
    try {
        const status = document.getElementById('statusFilter').value;
        
        let url = `/api/admin/subscriptions?page=${page}`;
        if (status) url += `&status=${status}`;

        const response = await fetch(url, {
            headers: {
                'Authorization': 'Bearer ' + currentToken
            }
        });

        const data = await response.json();

        if (data.success) {
            displaySubscriptions(data.data.subscriptions);
            displayPagination(data.data.pagination, 'subscriptionsPagination', loadSubscriptions);
        }
    } catch (error) {
        console.error('Error loading subscriptions:', error);
    }
}

// Display subscriptions
function displaySubscriptions(subscriptions) {
    const tbody = document.getElementById('subscriptionsTableBody');
    tbody.innerHTML = '';

    subscriptions.forEach(sub => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${sub.id}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${sub.user ? sub.user.username : 'N/A'}</td>
            <td class="px-6 py-4 whitespace-nowrap">
                <span class="inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                    sub.plan === 'premium' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'
                }">
                    ${sub.plan}
                </span>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
                <span class="inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                    sub.status === 'active' ? 'bg-green-100 text-green-800' :
                    sub.status === 'cancelled' ? 'bg-red-100 text-red-800' :
                    'bg-yellow-100 text-yellow-800'
                }">
                    ${sub.status}
                </span>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${new Date(sub.endDate).toLocaleDateString()}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${sub.searchesUsed}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${sub.searchesLimit}</td>
        `;
        tbody.appendChild(row);
    });
}

// Search users
function searchUsers() {
    loadUsers(1);
}

// Search subscriptions
function searchSubscriptions() {
    loadSubscriptions(1);
}

// Switch tabs
function switchTab(tabName) {
    console.log('Switching to tab:', tabName);
    
    // Update active tab
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.remove('border-blue-500', 'text-blue-600');
        tab.classList.add('border-transparent', 'text-gray-500');
    });
    
    // Hide all tab contents
    document.querySelectorAll('.tab-content').forEach(content => {
        content.style.display = 'none';
    });
    
    // Activate clicked tab
    const activeTab = document.querySelector(`[data-tab="${tabName}"]`);
    if (activeTab) {
        activeTab.classList.remove('border-transparent', 'text-gray-500');
        activeTab.classList.add('border-blue-500', 'text-blue-600');
    }
    
    // Show corresponding content
    const tabContent = document.getElementById(tabName + 'Tab');
    if (tabContent) {
        tabContent.style.display = 'block';
    }

    // Load data for selected tab
    if (tabName === 'users') {
        loadUsers();
    } else if (tabName === 'subscriptions') {
        loadSubscriptions();
    }
}

// Pagination
function displayPagination(pagination, containerId, loadFunction) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';

    for (let i = 1; i <= pagination.totalPages; i++) {
        const button = document.createElement('button');
        button.textContent = i;
        button.addEventListener('click', () => loadFunction(i));
        button.className = `px-3 py-2 text-sm font-medium rounded-md mx-1 ${
            i === pagination.currentPage 
                ? 'bg-blue-600 text-white' 
                : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
        }`;
        container.appendChild(button);
    }
}

// Edit user
async function editUser(userId) {
    try {
        const response = await fetch(`/api/admin/users/${userId}`, {
            headers: {
                'Authorization': 'Bearer ' + currentToken
            }
        });

        const data = await response.json();

        if (data.success) {
            const user = data.data;
            document.getElementById('editUsername').value = user.username;
            document.getElementById('editEmail').value = user.email;
            document.getElementById('editRole').value = user.role;
            document.getElementById('editFirstName').value = user.first_name || '';
            document.getElementById('editLastName').value = user.last_name || '';
            
            currentUserId = userId;
            document.getElementById('editModal').style.display = 'block';
        }
    } catch (error) {
        console.error('Error loading user:', error);
    }
}

// Save user
async function saveUser() {
    try {
        const userData = {
            username: document.getElementById('editUsername').value,
            email: document.getElementById('editEmail').value,
            role: document.getElementById('editRole').value,
            first_name: document.getElementById('editFirstName').value,
            last_name: document.getElementById('editLastName').value
        };

        const response = await fetch(`/api/admin/users/${currentUserId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + currentToken
            },
            body: JSON.stringify(userData)
        });

        const data = await response.json();

        if (data.success) {
            showAlert('User updated successfully', 'success');
            closeModal();
            loadUsers();
        } else {
            showAlert('Update error: ' + data.message, 'error');
        }
    } catch (error) {
        showAlert('Server connection error', 'error');
    }
}

// Delete user
async function deleteUser(userId) {
    if (!confirm('Are you sure you want to delete this user?')) {
        return;
    }

    try {
        const response = await fetch(`/api/admin/users/${userId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': 'Bearer ' + currentToken
            }
        });

        const data = await response.json();

        if (data.success) {
            showAlert('User deleted successfully', 'success');
            loadUsers();
        } else {
            showAlert('Delete error: ' + data.message, 'error');
        }
    } catch (error) {
        showAlert('Server connection error', 'error');
    }
}

// Manage subscription
function manageSubscription(userId) {
    currentUserId = userId;
    document.getElementById('subscriptionModal').style.display = 'block';
}

// Save subscription
async function saveSubscription() {
    try {
        const action = document.getElementById('subscriptionAction').value;
        const plan = document.getElementById('subscriptionPlan').value;
        const endDate = document.getElementById('subscriptionEndDate').value;
        const searchesLimit = document.getElementById('subscriptionSearchesLimit').value;

        const subscriptionData = {
            action: action,
            plan: plan,
            endDate: endDate ? new Date(endDate).toISOString() : null,
            searchesLimit: parseInt(searchesLimit)
        };

        const response = await fetch(`/api/admin/users/${currentUserId}/subscription`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + currentToken
            },
            body: JSON.stringify(subscriptionData)
        });

        const data = await response.json();

        if (data.success) {
            showAlert('Subscription updated successfully', 'success');
            closeModal();
            loadUsers();
        } else {
            showAlert('Subscription update error: ' + data.message, 'error');
        }
    } catch (error) {
        showAlert('Server connection error', 'error');
    }
}

// Close modal
function closeModal() {
    document.getElementById('editModal').style.display = 'none';
    document.getElementById('subscriptionModal').style.display = 'none';
}

// Show alert
function showAlert(message, type) {
    const container = document.getElementById('alertContainer');
    const alert = document.createElement('div');
    alert.className = `mb-4 p-4 rounded-lg shadow-lg ${
        type === 'success' 
            ? 'bg-green-100 border border-green-400 text-green-700' 
            : 'bg-red-100 border border-red-400 text-red-700'
    }`;
    alert.textContent = message;
    
    container.appendChild(alert);
    
    setTimeout(() => {
        alert.remove();
    }, 5000);
}

// Add event listeners when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    // Add event listeners for login and logout buttons
    document.getElementById('loginBtn').addEventListener('click', login);
    document.getElementById('logoutBtn').addEventListener('click', logout);

    // Add event listeners for tabs
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            const tabName = e.target.getAttribute('data-tab');
            if (tabName) {
                switchTab(tabName);
            }
        });
    });

    // Add event listeners for search inputs
    document.getElementById('userSearch').addEventListener('keyup', searchUsers);
    document.getElementById('roleFilter').addEventListener('change', searchUsers);
    document.getElementById('statusFilter').addEventListener('change', searchSubscriptions);

    // Add event listeners for modal close buttons
    document.querySelectorAll('.close').forEach(closeBtn => {
        closeBtn.addEventListener('click', closeModal);
    });

    // Add event listeners for modal save buttons
    document.getElementById('saveUserBtn').addEventListener('click', saveUser);
    document.getElementById('saveSubscriptionBtn').addEventListener('click', saveSubscription);

    // Close modal when clicking outside
    window.addEventListener('click', function(event) {
        const editModal = document.getElementById('editModal');
        const subscriptionModal = document.getElementById('subscriptionModal');
        
        if (event.target === editModal) {
            closeModal();
        }
        if (event.target === subscriptionModal) {
            closeModal();
        }
    });
}); 